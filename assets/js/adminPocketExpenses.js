import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      cashiers: [],
      bills: [],
      billLines: [],
      itemCosts: new Map(),
      roleByUserId: {},
      weekNetByUser: {},
      weekPocketByUser: {},
      pocketExpenses: [],
      total: 0,
      dateFrom: "",
      dateTo: "",
      pocketForm: {
        userId: "",
        amount: "",
        reason: "مصروف عادي",
        note: "",
      },
      pocketSaving: false,
      pocketError: "",
      cashierSharePct: 0,
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
    };
  },
  computed: {
    selectedWeekProfit() {
      if (!this.pocketForm.userId) return 0;
      return this.weekNetByUser[this.pocketForm.userId] || 0;
    },
    isAdminTarget() {
      if (!this.pocketForm.userId) return false;
      return this.roleByUserId[this.pocketForm.userId] === "admin";
    },
    exceedsWeekProfit() {
      const amount = Number(this.pocketForm.amount) || 0;
      return this.pocketForm.userId && amount > this.selectedWeekProfit;
    },
    showZeroProfitWarning() {
      return this.pocketForm.userId && this.selectedWeekProfit <= 0;
    },
  },
  methods: {
    formatMoney,
    formatDateTime,
    getCairoDateParts(date, timeZone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const values = {};
      parts.forEach((part) => {
        if (part.type !== "literal") values[part.type] = part.value;
      });
      return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
      };
    },
    getCairoHour(date, timeZone) {
      const hour = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hour12: false,
      }).format(date);
      return Number(hour);
    },
    getCairoWeekdayIndex(date, timeZone) {
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
      }).format(date);
      const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return map[weekday] ?? 0;
    },
    getTimeZoneOffset(date, timeZone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(date);
      const values = {};
      parts.forEach((part) => {
        if (part.type !== "literal") values[part.type] = part.value;
      });
      const asUTC = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
      );
      return (asUTC - date.getTime()) / 60000;
    },
    makeCairoDate(year, month, day, hour, minute, second, timeZone) {
      const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      const offset = this.getTimeZoneOffset(utcDate, timeZone);
      return new Date(utcDate.getTime() - offset * 60000);
    },
    getPeriodStarts() {
      const timeZone = "Africa/Cairo";
      const now = new Date();
      const todayParts = this.getCairoDateParts(now, timeZone);
      const hour = this.getCairoHour(now, timeZone);
      const dayIndex = this.getCairoWeekdayIndex(now, timeZone);
      const daysSinceMonday = (dayIndex + 6) % 7;

      const todayBase = new Date(
        Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)
      );
      todayBase.setUTCDate(todayBase.getUTCDate() - daysSinceMonday);
      const mondayParts = {
        year: todayBase.getUTCFullYear(),
        month: todayBase.getUTCMonth() + 1,
        day: todayBase.getUTCDate(),
      };

      let startOfWeek = this.makeCairoDate(
        mondayParts.year,
        mondayParts.month,
        mondayParts.day,
        12,
        0,
        0,
        timeZone
      );

      if (now < startOfWeek) {
        todayBase.setUTCDate(todayBase.getUTCDate() - 7);
        mondayParts.year = todayBase.getUTCFullYear();
        mondayParts.month = todayBase.getUTCMonth() + 1;
        mondayParts.day = todayBase.getUTCDate();
        startOfWeek = this.makeCairoDate(
          mondayParts.year,
          mondayParts.month,
          mondayParts.day,
          12,
          0,
          0,
          timeZone
        );
      }

      const endBase = new Date(
        Date.UTC(mondayParts.year, mondayParts.month - 1, mondayParts.day)
      );
      endBase.setUTCDate(endBase.getUTCDate() + 7);
      const endWeekParts = {
        year: endBase.getUTCFullYear(),
        month: endBase.getUTCMonth() + 1,
        day: endBase.getUTCDate(),
      };

      const endOfWeek = this.makeCairoDate(
        endWeekParts.year,
        endWeekParts.month,
        endWeekParts.day,
        6,
        0,
        0,
        timeZone
      );

      return { startOfWeek, endOfWeek };
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
      await this.loadPocketExpenses();
    },
    async loadCashiers() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, full_name, role")
        .in("role", ["cashier", "admin"])
        .order("username");
      this.cashiers = data || [];
      this.roleByUserId = (data || []).reduce((acc, row) => {
        acc[row.id] = row.role;
        return acc;
      }, {});
      this.calculateWeekProfits();
    },
    async loadBills() {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("bills")
        .select("id, total, share_pct, created_at, created_by")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      this.bills = data || [];
      this.calculateWeekProfits();
    },
    async loadBillLines() {
      const { data } = await supabase
        .from("bill_lines")
        .select("id, bill_id, ref_id, line_type, qty, cost_price");
      this.billLines = data || [];
      this.calculateWeekProfits();
    },
    async loadItemCosts() {
      const { data } = await supabase
        .from("items")
        .select("id, cost_price");
      this.itemCosts = new Map(
        (data || []).map((item) => [item.id, Number(item.cost_price) || 0])
      );
      this.calculateWeekProfits();
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
      this.calculateWeekProfits();
    },
    getBillSharePct(bill, role) {
      const stored = Number(bill?.share_pct);
      if (Number.isFinite(stored) && stored > 0) return stored;
      const fallback = role === "admin" ? 100 : Number(this.cashierSharePct) || 0;
      return Math.round(fallback * 100) / 100;
    },
    calculateWeekProfits() {
      const { startOfWeek, endOfWeek } = this.getPeriodStarts();
      const costPerBill = new Map();
      (this.billLines || []).forEach((line) => {
        if (line.line_type !== "item") return;
        const qty = Number(line.qty) || 0;
        const lineCost = Number(line.cost_price) || 0;
        const fallbackCost = this.itemCosts.get(line.ref_id) || 0;
        const cost = (lineCost || fallbackCost) * qty;
        costPerBill.set(line.bill_id, (costPerBill.get(line.bill_id) || 0) + cost);
      });

      const weekTotals = {};
      (this.bills || []).forEach((bill) => {
        if (!bill.created_by) return;
        const billDate = new Date(bill.created_at);
        if (billDate < startOfWeek || billDate > endOfWeek) return;
        const gross = Number(bill.total) || 0;
        const role = this.roleByUserId[bill.created_by];
        const cost = costPerBill.get(bill.id) || 0;
        const baseNet = gross - cost;
        const sharePct = this.getBillSharePct(bill, role);
        const net = (baseNet * sharePct) / 100;
        weekTotals[bill.created_by] = (weekTotals[bill.created_by] || 0) + net;
      });

      const pocketTotals = {};
      (this.pocketExpenses || []).forEach((row) => {
        const rowDate = new Date(row.created_at);
        if (rowDate < startOfWeek || rowDate > endOfWeek) return;
        if (!row.user_id) return;
        const amount = Number(row.amount) || 0;
        pocketTotals[row.user_id] = (pocketTotals[row.user_id] || 0) + amount;
      });

      Object.keys(pocketTotals).forEach((userId) => {
        weekTotals[userId] = (weekTotals[userId] || 0) - pocketTotals[userId];
      });

      this.weekPocketByUser = pocketTotals;
      this.weekNetByUser = weekTotals;
    },
    weekProfitFor(userId) {
      return this.weekNetByUser[userId] || 0;
    },
    async loadPocketExpenses() {
      let query = supabase
        .from("pocket_expenses")
        .select("id, user_id, amount, reason, note, created_at, profiles(id, username, full_name)")
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
      this.pocketExpenses = data || [];
      this.total = this.pocketExpenses.reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      );
      this.calculateWeekProfits();
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
    async resetRange() {
      this.dateFrom = "";
      this.dateTo = "";
      await this.loadPocketExpenses();
    },
    async addPocketExpense() {
      if (!this.pocketForm.userId) {
        this.pocketError = "اختر الموظف اولا.";
        return;
      }
      const amount = Number(this.pocketForm.amount) || 0;
      if (amount <= 0) {
        this.pocketError = "ادخل مبلغ صحيح.";
        return;
      }
      if (this.exceedsWeekProfit && !this.isAdminTarget) {
        this.pocketError = "لا يمكن ان يتجاوز المصروف صافي ربح الاسبوع.";
        return;
      }
      const reason = this.exceedsWeekProfit && this.isAdminTarget
        ? "بضاعة محل او امور اخرى"
        : this.pocketForm.reason;
      this.pocketError = "";
      this.pocketSaving = true;
      const payload = {
        user_id: this.pocketForm.userId,
        amount,
        reason,
        note: this.pocketForm.note || null,
      };
      const { error } = await supabase.from("pocket_expenses").insert(payload);
      this.pocketSaving = false;
      if (error) {
        this.pocketError = "تعذر حفظ مصروف الجيب.";
        return;
      }
      this.pocketForm.userId = "";
      this.pocketForm.amount = "";
      this.pocketForm.reason = "مصروف عادي";
      this.pocketForm.note = "";
      await this.loadPocketExpenses();
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
    },
    subscribeRealtime() {
      supabase
        .channel("pocket-expenses-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pocket_expenses" },
          () => this.loadPocketExpenses()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => this.loadBills()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bill_lines" },
          () => this.loadBillLines()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => this.loadItemCosts()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "profiles" },
          () => this.loadCashiers()
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
    await this.loadCashiers();
    await this.loadBills();
    await this.loadBillLines();
    await this.loadItemCosts();
    await this.loadPocketExpenses();
    await this.loadSoldOut();
    await this.loadSettings();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
