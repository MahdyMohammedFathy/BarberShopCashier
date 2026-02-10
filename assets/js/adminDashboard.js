import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime, businessDayRangeIso, sumTotals } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      bills: [],
      billsToday: [],
      lineItems: {},
      loadingLines: {},
      pocketExpenses: [],
      pocketTodayTotal: 0,
      pocketWeekTotal: 0,
      pocketMonthTotal: 0,
      pocketYearTotal: 0,
      todayTotal: 0,
      weekTotal: 0,
      monthTotal: 0,
      yearTotal: 0,
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
      cashierSharePct: 0,
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

      const startBase = new Date(
        Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)
      );
      if (hour < 12) {
        startBase.setUTCDate(startBase.getUTCDate() - 1);
      }
      const startParts = {
        year: startBase.getUTCFullYear(),
        month: startBase.getUTCMonth() + 1,
        day: startBase.getUTCDate(),
      };
      const startOfToday = this.makeCairoDate(
        startParts.year,
        startParts.month,
        startParts.day,
        12,
        0,
        0,
        timeZone
      );
      const endBase = new Date(
        Date.UTC(startParts.year, startParts.month - 1, startParts.day)
      );
      endBase.setUTCDate(endBase.getUTCDate() + 1);
      const endParts = {
        year: endBase.getUTCFullYear(),
        month: endBase.getUTCMonth() + 1,
        day: endBase.getUTCDate(),
      };
      const endOfToday = this.makeCairoDate(
        endParts.year,
        endParts.month,
        endParts.day,
        6,
        0,
        0,
        timeZone
      );
      const startOfMonth = this.makeCairoDate(
        todayParts.year,
        todayParts.month,
        1,
        0,
        0,
        0,
        timeZone
      );
      const startOfYear = this.makeCairoDate(
        todayParts.year,
        1,
        1,
        0,
        0,
        0,
        timeZone
      );

      return { startOfToday, endOfToday, startOfWeek, startOfMonth, startOfYear };
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
    async loadBills() {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("bills")
        .select("id, total, share_pct, created_at, profiles(id, username, full_name, role)")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      this.bills = data || [];
      this.calculateTotals();
    },
    async loadTodayBills() {
      const { startIso, endIso } = businessDayRangeIso();
      const { data } = await supabase
        .from("bills")
        .select("id, total, share_pct, created_at, profiles(id, username, full_name, role)")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false });
      this.billsToday = data || [];
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
    async loadPocketExpenses() {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("pocket_expenses")
        .select("id, amount, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      this.pocketExpenses = data || [];
      this.calculateTotals();
    },
    calculateTotals() {
      const { startOfToday, endOfToday, startOfWeek, startOfMonth, startOfYear } =
        this.getPeriodStarts();

      const today = this.bills.filter(
        (bill) =>
          new Date(bill.created_at) >= startOfToday &&
          new Date(bill.created_at) <= endOfToday
      );
      const month = this.bills.filter(
        (bill) => new Date(bill.created_at) >= startOfMonth
      );
      const week = this.bills.filter(
        (bill) => new Date(bill.created_at) >= startOfWeek
      );
      const year = this.bills.filter(
        (bill) => new Date(bill.created_at) >= startOfYear
      );

      const pocketToday = (this.pocketExpenses || []).filter((row) => {
        const rowDate = new Date(row.created_at);
        return rowDate >= startOfToday && rowDate <= endOfToday;
      });
      const pocketWeek = (this.pocketExpenses || []).filter(
        (row) => new Date(row.created_at) >= startOfWeek
      );
      const pocketMonth = (this.pocketExpenses || []).filter(
        (row) => new Date(row.created_at) >= startOfMonth
      );
      const pocketYear = (this.pocketExpenses || []).filter(
        (row) => new Date(row.created_at) >= startOfYear
      );

      const pocketSum = (list) =>
        list.reduce((total, row) => total + (Number(row.amount) || 0), 0);

      this.pocketTodayTotal = pocketSum(pocketToday);
      this.pocketWeekTotal = pocketSum(pocketWeek);
      this.pocketMonthTotal = pocketSum(pocketMonth);
      this.pocketYearTotal = pocketSum(pocketYear);

      this.todayTotal = sumTotals(today) - this.pocketTodayTotal;
      this.weekTotal = sumTotals(week) - this.pocketWeekTotal;
      this.monthTotal = sumTotals(month) - this.pocketMonthTotal;
      this.yearTotal = sumTotals(year) - this.pocketYearTotal;
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
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
    subscribeRealtime() {
      supabase
        .channel("admin-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => {
            this.loadBills();
            this.loadTodayBills();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bill_lines" },
          () => this.loadTodayBills()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => this.loadSoldOut()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pocket_expenses" },
          () => this.loadPocketExpenses()
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
    await this.loadTodayBills();
    await this.loadPocketExpenses();
    await this.loadSoldOut();
    await this.loadSettings();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
