import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime, sumTotals } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      bills: [],
      todayTotal: 0,
      weekTotal: 0,
      monthTotal: 0,
      yearTotal: 0,
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
    };
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

      const startOfToday = this.makeCairoDate(
        todayParts.year,
        todayParts.month,
        todayParts.day,
        0,
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

      return { startOfToday, startOfWeek, startOfMonth, startOfYear };
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
        .select("id, total, created_at, profiles(id, username, full_name)")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      this.bills = data || [];
      this.calculateTotals();
    },
    calculateTotals() {
      const { startOfToday, startOfWeek, startOfMonth, startOfYear } =
        this.getPeriodStarts();

      const today = this.bills.filter(
        (bill) => new Date(bill.created_at) >= startOfToday
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

      this.todayTotal = sumTotals(today);
      this.weekTotal = sumTotals(week);
      this.monthTotal = sumTotals(month);
      this.yearTotal = sumTotals(year);
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
    },
    subscribeRealtime() {
      supabase
        .channel("admin-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => this.loadBills()
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
    await this.loadSoldOut();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
