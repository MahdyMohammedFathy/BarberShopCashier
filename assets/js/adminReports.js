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
      cashierSharePct: 0,
      settingsSaving: false,
      settingsError: "",
    };
  },
  methods: {
    formatMoney,
    formatDateTime,
    getBillSharePct(bill) {
      const stored = Number(bill?.share_pct);
      if (Number.isFinite(stored) && stored > 0) return stored;
      const role = bill?.profiles?.role;
      const fallback = role === "admin" ? 100 : Number(this.cashierSharePct) || 0;
      return Math.round(fallback * 100) / 100;
    },
    formatDateInput(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },
    async setRange(range) {
      const now = new Date();
      let start;
      let end;

      if (range === "today") {
        start = new Date(now);
        end = new Date(now);
      }

      if (range === "week") {
        start = new Date(now);
        const dayIndex = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - dayIndex);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
      }

      if (range === "month") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }

      if (range === "year") {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
      }

      if (!start || !end) return;
      this.dateFrom = this.formatDateInput(start);
      this.dateTo = this.formatDateInput(end);
      await this.loadBills();
    },
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
        .select("id, username, role, full_name, created_at, active")
        .order("created_at", { ascending: false });
      this.users = data || [];
    },
    async loadSettings() {
      const { data, error } = await supabase
        .from("app_settings")
        .select("key, value")
        .eq("key", "cashier_share_pct")
        .maybeSingle();
      if (error) {
        this.cashierSharePct = 0;
        return;
      }
      this.cashierSharePct = Number(data?.value) || 0;
    },
    async saveSettings() {
      const raw = Number(this.cashierSharePct);
      const nextValue = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
      this.cashierSharePct = nextValue;
      this.settingsSaving = true;
      this.settingsError = "";
      const payload = {
        key: "cashier_share_pct",
        value: nextValue,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("app_settings")
        .upsert(payload, { onConflict: "key" });
      this.settingsSaving = false;
      if (error) {
        this.settingsError = "تعذر حفظ نسبة الكاشير.";
      }
    },
    async toggleUserActive(user) {
      if (user.role !== "cashier") return;
      const nextActive = !user.active;
      const { error } = await supabase
        .from("profiles")
        .update({ active: nextActive })
        .eq("id", user.id);
      if (!error) {
        this.loadUsers();
      }
    },
    async loadBills() {
      let query = supabase
        .from("bills")
        .select("id, total, share_pct, created_at, profiles(username, role)")
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
      window.location.href = "index.html";
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
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_settings" },
          () => this.loadSettings()
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
    await this.loadSettings();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
