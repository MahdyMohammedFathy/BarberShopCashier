import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireAnyRole, signOut } from "./auth.js";
import { formatMoney, formatDateTime, businessDayRangeIso, sumTotals } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      items: [],
      services: [],
      billLines: [],
      todayBills: [],
      todayTotal: 0,
      weekGross: 0,
      weekNet: 0,
      weekNetBase: 0,
      weekShareLabel: "",
      weekPocket: 0,
      weekLabel: "",
      itemCosts: new Map(),
      saving: false,
      discount: 0,
      error: "",
      cashierSharePct: 0,
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
    getBillSharePct(bill) {
      const stored = Number(bill?.share_pct);
      if (Number.isFinite(stored) && stored > 0) return stored;
      const role = bill?.profiles?.role || this.profile?.role;
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
      const { startIso, endIso } = businessDayRangeIso();
      const { data } = await supabase
        .from("bills")
        .select("id, total, share_pct, created_at, profiles(username, role)")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false });
      this.todayBills = data || [];
      this.todayTotal = sumTotals(this.todayBills);
    },
    async loadItemCosts() {
      const { data } = await supabase
        .from("items")
        .select("id, cost_price");
      this.itemCosts = new Map(
        (data || []).map((item) => [item.id, Number(item.cost_price) || 0])
      );
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
    async loadWeekStats() {
      if (!this.profile?.id) return;
      const { startOfWeek, endOfWeek } = this.getPeriodStarts();
      this.weekLabel = `${this.formatDateTime(startOfWeek)} - ${this.formatDateTime(endOfWeek)}`;

      const { data: bills } = await supabase
        .from("bills")
        .select("id, total, share_pct, created_at, created_by")
        .eq("created_by", this.profile.id)
        .gte("created_at", startOfWeek.toISOString())
        .lte("created_at", endOfWeek.toISOString())
        .order("created_at", { ascending: false });

      const weekBills = bills || [];
      const billIds = weekBills.map((bill) => bill.id);
      let billLines = [];
      if (billIds.length) {
        const { data } = await supabase
          .from("bill_lines")
          .select("bill_id, ref_id, line_type, qty, cost_price")
          .in("bill_id", billIds);
        billLines = data || [];
      }

      const costPerBill = new Map();
      billLines.forEach((line) => {
        if (line.line_type !== "item") return;
        const qty = Number(line.qty) || 0;
        const lineCost = Number(line.cost_price) || 0;
        const fallbackCost = this.itemCosts.get(line.ref_id) || 0;
        const cost = (lineCost || fallbackCost) * qty;
        costPerBill.set(line.bill_id, (costPerBill.get(line.bill_id) || 0) + cost);
      });

      const gross = weekBills.reduce(
        (sum, bill) => sum + (Number(bill.total) || 0),
        0
      );
      const cost = weekBills.reduce((sum, bill) => sum + (costPerBill.get(bill.id) || 0), 0);

      const shareNet = weekBills.reduce((sum, bill) => {
        const billCost = costPerBill.get(bill.id) || 0;
        const baseNet = (Number(bill.total) || 0) - billCost;
        const sharePct = this.getBillSharePct(bill);
        return sum + (baseNet * sharePct) / 100;
      }, 0);

      const baseNetTotal = weekBills.reduce((sum, bill) => {
        const billCost = costPerBill.get(bill.id) || 0;
        return sum + ((Number(bill.total) || 0) - billCost);
      }, 0);

      const shareValues = weekBills
        .map((bill) => this.getBillSharePct(bill))
        .filter((value) => Number.isFinite(value));
      const shareMin = shareValues.length ? Math.min(...shareValues) : 0;
      const shareMax = shareValues.length ? Math.max(...shareValues) : 0;
      const shareLabel = shareMin === shareMax
        ? `${shareMin}%`
        : `${shareMin}% - ${shareMax}%`;

      const { data: pocketRows } = await supabase
        .from("pocket_expenses")
        .select("amount, created_at")
        .eq("user_id", this.profile.id)
        .gte("created_at", startOfWeek.toISOString())
        .lte("created_at", endOfWeek.toISOString());

      const pocketTotal = (pocketRows || []).reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      );

      this.weekGross = gross;
      this.weekPocket = pocketTotal;
      this.weekNet = shareNet - pocketTotal;
      this.weekNetBase = baseNetTotal;
      this.weekShareLabel = weekBills.length
        ? `(${this.formatMoney(baseNetTotal)} x ${shareLabel})`
        : "";
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
          share_pct: this.profile?.role === "admin" ? 100 : this.cashierSharePct,
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
        await this.loadWeekStats();
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
      await this.loadWeekStats();
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
    },
    subscribeRealtime() {
      supabase
        .channel("cashier-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bills" },
          () => {
            this.loadTodayBills();
            this.loadWeekStats();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => {
            this.loadCatalog();
            this.loadItemCosts();
            this.loadWeekStats();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "services" },
          () => this.loadCatalog()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bill_lines" },
          () => this.loadWeekStats()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "pocket_expenses" },
          () => this.loadWeekStats()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_settings" },
          () => this.loadSettings().then(() => this.loadWeekStats())
        )
        .subscribe();
    },
  },
  async mounted() {
    this.profile = await requireAnyRole(["cashier", "admin"]);
    if (!this.profile) return;
    await this.loadCatalog();
    await this.loadTodayBills();
    await this.loadItemCosts();
    await this.loadSettings();
    await this.loadWeekStats();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
