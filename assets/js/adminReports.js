import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime, sumTotals } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      bills: [],
      users: [],
      total: 0,
      dateFrom: "",
      dateTo: "",
      lineItems: {},
      loadingLines: {},
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
    };
  },
  methods: {
    formatMoney,
    formatDateTime,
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
    async loadUsers() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, role, full_name, created_at")
        .order("created_at", { ascending: false });
      this.users = data || [];
    },
    async loadBills() {
      let query = supabase
        .from("bills")
        .select("id, total, created_at, profiles(username)")
        .order("created_at", { ascending: false });

      if (this.dateFrom) {
        query = query.gte("created_at", new Date(this.dateFrom).toISOString());
      }
      if (this.dateTo) {
        const end = new Date(this.dateTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }

      const { data } = await query;
      this.bills = data || [];
      this.total = sumTotals(this.bills);
    },
    async resetRange() {
      this.dateFrom = "";
      this.dateTo = "";
      await this.loadBills();
    },
    async toggleLines(billId) {
      if (this.lineItems[billId]) {
        this.lineItems[billId] = null;
        return;
      }
      this.loadingLines[billId] = true;
      const { data } = await supabase
        .from("bill_lines")
        .select("id, name, qty, unit_price, total, line_type")
        .eq("bill_id", billId)
        .order("name");
      this.lineItems[billId] = data || [];
      this.loadingLines[billId] = false;
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "login.html";
    },
    subscribeRealtime() {
      supabase
        .channel("reports-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => this.loadBills()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "profiles" },
          () => this.loadUsers()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => this.loadSoldOut()
        )
        .subscribe();
    },
  },
  async mounted() {
    this.profile = await requireRole("admin");
    if (!this.profile) return;
    await this.loadBills();
    await this.loadUsers();
    await this.loadSoldOut();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
