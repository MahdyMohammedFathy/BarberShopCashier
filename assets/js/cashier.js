import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireAnyRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime, startOfTodayIso, sumTotals } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      items: [],
      services: [],
      billLines: [],
      todayBills: [],
      todayTotal: 0,
      saving: false,
      discount: 0,
      error: "",
    };
  },
  computed: {
    billSubtotal() {
      return this.billLines.reduce((total, line) => total + line.total, 0);
    },
    discountValue() {
      const raw = Number(this.discount) || 0;
      return Math.max(0, Math.min(raw, this.billSubtotal));
    },
    billTotal() {
      return this.billSubtotal - this.discountValue;
    },
  },
  methods: {
    formatMoney,
    formatDateTime,
    async loadCatalog() {
      const { data: items } = await supabase
        .from("items")
        .select("id, name, price, cost_price, stock_qty, active")
        .eq("active", true)
        .order("name");
      const { data: services } = await supabase
        .from("services")
        .select("id, name, price, active")
        .eq("active", true)
        .order("name");
      this.items = items || [];
      this.services = services || [];
    },
    async loadTodayBills() {
      const { data } = await supabase
        .from("bills")
        .select("id, total, created_at, profiles(username)")
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: false });
      this.todayBills = data || [];
      this.todayTotal = sumTotals(this.todayBills);
    },
    addLine(type, record) {
      if (type === "item" && Number(record.stock_qty) <= 0) {
        this.error = "المنتج غير متوفر حاليا.";
        return;
      }
      const existing = this.billLines.find(
        (line) => line.type === type && line.ref_id === record.id
      );
      if (existing) {
        if (type === "item") {
          const maxQty = Number(record.stock_qty) || 0;
          if (existing.qty + 1 > maxQty) {
            this.error = "لا يمكن تجاوز كمية المخزون.";
            return;
          }
        }
        existing.qty += 1;
        existing.total = existing.qty * existing.unit_price;
        return;
      }
      this.billLines.push({
        type,
        ref_id: record.id,
        name: record.name,
        qty: 1,
        unit_price: record.price,
        cost_price: type === "item" ? record.cost_price : 0,
        total: record.price,
      });
    },
    updateQty(line) {
      const safeQty = Number(line.qty) || 1;
      line.qty = safeQty <= 0 ? 1 : safeQty;
      line.total = line.qty * line.unit_price;
    },
    removeLine(index) {
      this.billLines.splice(index, 1);
    },
    async completeBill() {
      if (!this.billLines.length) {
        this.error = "اضف صنفا او خدمة واحدة على الاقل.";
        return;
      }
      this.error = "";
      this.saving = true;

      const itemLines = this.billLines.filter((line) => line.type === "item");
      if (itemLines.length) {
        const ids = itemLines.map((line) => line.ref_id);
        const { data: stocks } = await supabase
          .from("items")
          .select("id, stock_qty")
          .in("id", ids);
        const stockMap = new Map((stocks || []).map((row) => [row.id, row.stock_qty]));
        const insufficient = itemLines.some((line) => {
          const available = Number(stockMap.get(line.ref_id)) || 0;
          return available < line.qty;
        });
        if (insufficient) {
          this.error = "المخزون غير كاف لبعض الاصناف.";
          this.saving = false;
          return;
        }
      }
      const { data: bill, error } = await supabase
        .from("bills")
        .insert({
          created_by: this.profile.id,
          total: this.billTotal,
          discount: this.discountValue,
        })
        .select("id")
        .single();

      if (error || !bill) {
        this.error = "تعذر حفظ الفاتورة.";
        this.saving = false;
        return;
      }

      const linesPayload = this.billLines.map((line) => ({
        bill_id: bill.id,
        line_type: line.type,
        ref_id: line.ref_id,
        name: line.name,
        qty: line.qty,
        unit_price: line.unit_price,
        cost_price: line.type === "item" ? Number(line.cost_price) || 0 : 0,
        total: line.total,
      }));

      const { error: linesError } = await supabase
        .from("bill_lines")
        .insert(linesPayload);

      if (linesError) {
        this.error = "تم حفظ الفاتورة لكن تفاصيلها لم تحفظ.";
        this.saving = false;
        await this.loadTodayBills();
        return;
      }

      if (itemLines.length) {
        const results = await Promise.all(
          itemLines.map((line) =>
            supabase.rpc("decrement_item_stock", {
              item_id: line.ref_id,
              qty: line.qty,
            })
          )
        );
        const failed = results.some((res) => res.error || res.data !== true);
        if (failed) {
          this.error = "تم حفظ الفاتورة لكن تحديث المخزون فشل.";
        }
      }

      this.billLines = [];
      this.discount = 0;
      this.saving = false;
      await this.loadTodayBills();
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "login.html";
    },
    subscribeRealtime() {
      supabase
        .channel("cashier-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => this.loadTodayBills()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => this.loadCatalog()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "services" },
          () => this.loadCatalog()
        )
        .subscribe();
    },
  },
  async mounted() {
    this.profile = await requireAnyRole(["cashier", "admin"]);
    if (!this.profile) return;
    await this.loadCatalog();
    await this.loadTodayBills();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
