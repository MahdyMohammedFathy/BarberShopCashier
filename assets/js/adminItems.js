import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney } from "./utils.js";

const emptyItem = () => ({
  name: "",
  price: "",
  stock_qty: "",
  active: true,
});
const emptyService = () => ({ name: "", price: "", active: true });

const app = {
  data() {
    return {
      profile: null,
      items: [],
      services: [],
      newItem: emptyItem(),
      newService: emptyService(),
      editingItem: null,
      editingService: null,
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
    };
  },
  methods: {
    formatMoney,
    async loadSoldOut() {
      const { data } = await supabase
        .from("items")
        .select("id, name, stock_qty")
        .eq("active", true)
        .lte("stock_qty", 0)
        .order("name");
      this.soldOutItems = data || [];
      if (this.soldOutItems.length) {
        this.bannerVisible = true;
        if (this.bannerTimer) {
          clearTimeout(this.bannerTimer);
        }
        this.bannerTimer = setTimeout(() => {
          this.bannerVisible = false;
        }, 40000);
      } else {
        this.bannerVisible = false;
      }
    },
    async loadAll() {
      const { data: items } = await supabase
        .from("items")
        .select("id, name, price, cost_price, stock_qty, active")
        .order("name");
      const { data: services } = await supabase
        .from("services")
        .select("id, name, price, active")
        .order("name");
      this.items = items || [];
      this.services = services || [];
    },
    async addItem() {
      if (!this.newItem.name.trim()) return;
      const price = Number(this.newItem.price) || 0;
      await supabase.from("items").insert({
        name: this.newItem.name.trim(),
        price,
        cost_price: price,
        stock_qty: Number(this.newItem.stock_qty) || 0,
        active: true,
      });
      this.newItem = emptyItem();
      await this.loadAll();
    },
    async addService() {
      if (!this.newService.name.trim()) return;
      await supabase.from("services").insert({
        name: this.newService.name.trim(),
        price: Number(this.newService.price) || 0,
        active: true,
      });
      this.newService = emptyService();
      await this.loadAll();
    },
    editItem(item) {
      this.editingService = null;
      this.editingItem = { ...item };
    },
    editService(service) {
      this.editingItem = null;
      this.editingService = { ...service };
    },
    async saveItem() {
      if (!this.editingItem) return;
      const price = Number(this.editingItem.price) || 0;
      await supabase
        .from("items")
        .update({
          name: this.editingItem.name,
          price,
          cost_price: price,
          stock_qty: this.editingItem.stock_qty,
          active: this.editingItem.active,
        })
        .eq("id", this.editingItem.id);
      this.editingItem = null;
      await this.loadAll();
    },
    async saveService() {
      if (!this.editingService) return;
      await supabase
        .from("services")
        .update({
          name: this.editingService.name,
          price: this.editingService.price,
          active: this.editingService.active,
        })
        .eq("id", this.editingService.id);
      this.editingService = null;
      await this.loadAll();
    },
    async deleteItem(item) {
      await supabase.from("items").delete().eq("id", item.id);
      await this.loadAll();
    },
    async deleteService(service) {
      await supabase.from("services").delete().eq("id", service.id);
      await this.loadAll();
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
    },
    subscribeRealtime() {
      supabase
        .channel("items-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => {
            this.loadAll();
            this.loadSoldOut();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "services" },
          () => this.loadAll()
        )
        .subscribe();
    },
  },
  async mounted() {
    this.profile = await requireRole("admin");
    if (!this.profile) return;
    await this.loadAll();
    await this.loadSoldOut();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
