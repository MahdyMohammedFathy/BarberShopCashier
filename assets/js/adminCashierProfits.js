import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { supabase } from "./supabaseClient.js";
import { requireRole, signOut } from "./auth.js";
import { formatMoney } from "./utils.js";

const app = {
  data() {
    return {
      profile: null,
      cashiers: [],
      bills: [],
      billLines: [],
      itemCosts: new Map(),
      stats: [],
      weekLabel: "",
      soldOutItems: [],
      bannerVisible: false,
      bannerTimer: null,
    };
  },
  computed: {
    weekBills() {
      const { startOfWeek, endOfWeek } = this.getPeriodStarts();
      return (this.bills || []).filter((bill) => {
        const billDate = new Date(bill.created_at);
        return billDate >= startOfWeek && billDate <= endOfWeek;
      });
    },
    billLinesByBillId() {
      const map = {};
      (this.billLines || []).forEach((line) => {
        if (!map[line.bill_id]) map[line.bill_id] = [];
        map[line.bill_id].push(line);
      });
      return map;
    },
  },
  methods: {
    formatMoney,
    formatDate(value) {
      const date = new Date(value);
      return date.toLocaleDateString("ar-EG", {
        numberingSystem: "latn",
        timeZone: "Africa/Cairo",
      });
    },
    formatDateTime(value) {
      const date = new Date(value);
      return date.toLocaleString("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        numberingSystem: "latn",
        timeZone: "Africa/Cairo",
      });
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
      const endParts = {
        year: endBase.getUTCFullYear(),
        month: endBase.getUTCMonth() + 1,
        day: endBase.getUTCDate(),
      };

      const endOfWeek = this.makeCairoDate(
        endParts.year,
        endParts.month,
        endParts.day,
        6,
        0,
        0,
        timeZone
      );

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

      return { startOfToday, startOfWeek, startOfMonth, endOfWeek };
    },
    async loadCashiers() {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, full_name")
        .eq("role", "cashier")
        .order("username");
      this.cashiers = data || [];
      this.calculateStats();
    },
    async loadBills() {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("bills")
        .select("id, total, discount, created_at, created_by, profiles(id, username, full_name)")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      this.bills = data || [];
      this.calculateStats();
    },
    async loadBillLines() {
      const { data } = await supabase
        .from("bill_lines")
        .select("id, bill_id, ref_id, line_type, qty, name, unit_price, total, cost_price");
      this.billLines = data || [];
      this.calculateStats();
    },
    async loadItemCosts() {
      const { data } = await supabase
        .from("items")
        .select("id, cost_price");
      this.itemCosts = new Map(
        (data || []).map((item) => [item.id, Number(item.cost_price) || 0])
      );
      this.calculateStats();
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
    calculateStats() {
      const { startOfToday, startOfWeek, startOfMonth, endOfWeek } =
        this.getPeriodStarts();

      this.weekLabel = `${this.formatDateTime(startOfWeek)} - ${this.formatDateTime(endOfWeek)}`;

      const costPerBill = new Map();
      (this.billLines || []).forEach((line) => {
        if (line.line_type !== "item") return;
        const qty = Number(line.qty) || 0;
        const lineCost = Number(line.cost_price) || 0;
        const fallbackCost = this.itemCosts.get(line.ref_id) || 0;
        const cost = (lineCost || fallbackCost) * qty;
        costPerBill.set(line.bill_id, (costPerBill.get(line.bill_id) || 0) + cost);
      });

      const statsMap = new Map(
        (this.cashiers || []).map((cashier) => [
          cashier.id,
          {
            id: cashier.id,
            name: cashier.full_name || cashier.username,
            todayGross: 0,
            todayNet: 0,
            weekGross: 0,
            weekNet: 0,
            monthGross: 0,
            monthNet: 0,
          },
        ])
      );

      (this.bills || []).forEach((bill) => {
        const profileId = bill.created_by || bill.profiles?.id;
        if (!profileId || !statsMap.has(profileId)) return;
        const billDate = new Date(bill.created_at);
        const gross = Number(bill.total) || 0;
        const cost = costPerBill.get(bill.id) || 0;
        const net = gross - cost;
        const entry = statsMap.get(profileId);

        if (billDate >= startOfToday) {
          entry.todayGross += gross;
          entry.todayNet += net;
        }
        if (billDate >= startOfWeek) {
          entry.weekGross += gross;
          entry.weekNet += net;
        }
        if (billDate >= startOfMonth) {
          entry.monthGross += gross;
          entry.monthNet += net;
        }
      });

      this.stats = Array.from(statsMap.values());
    },
    async handleSignOut() {
      await signOut();
      window.location.href = "index.html";
    },
    openPrintView() {
      const win = window.open("", "_blank");
      if (!win) return;

      const reportRows = this.stats
        .map(
          (row) => `
            <tr>
              <td>${row.name}</td>
              <td>${this.formatMoney(row.todayGross)}</td>
              <td>${this.formatMoney(row.todayNet)}</td>
              <td>${this.formatMoney(row.weekGross)}</td>
              <td>${this.formatMoney(row.weekNet)}</td>
              <td>${this.formatMoney(row.monthGross)}</td>
              <td>${this.formatMoney(row.monthNet)}</td>
            </tr>
          `
        )
        .join("");

      const billsByCashier = new Map();
      const sortedBills = [...this.weekBills].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
      sortedBills.forEach((bill) => {
        const cashierName = bill.profiles?.full_name || bill.profiles?.username || "-";
        if (!billsByCashier.has(cashierName)) {
          billsByCashier.set(cashierName, []);
        }
        billsByCashier.get(cashierName).push(bill);
      });

      const billsRows = Array.from(billsByCashier.entries())
        .map(([cashierName, bills]) => {
          const groupHeader = `
            <tr class="cashier-head">
              <td colspan="9">الكاشير: ${cashierName} | عدد الفواتير: ${bills.length}</td>
            </tr>
          `;
          const billBlocks = bills
            .map((bill) => {
              const billId = bill.id?.slice(0, 8) || "-";
              const discount = Number(bill.discount) || 0;
              const discountLabel = discount > 0 ? ` | الخصم: ${this.formatMoney(discount)}` : "";
              const billHeader = `
                <tr class="bill-head">
                  <td colspan="9">
                    فاتورة #${billId} | الوقت: ${this.formatDateTime(bill.created_at)} | الاجمالي: ${this.formatMoney(bill.total)}${discountLabel}
                  </td>
                </tr>
              `;
              const lines = (this.billLinesByBillId[bill.id] || [])
                .map(
                  (line, index) => `
                    <tr>
                      <td>${index === 0 ? this.formatDateTime(bill.created_at) : ""}</td>
                      <td>${index === 0 ? cashierName : ""}</td>
                      <td>${line.name}</td>
                      <td>${line.line_type}</td>
                      <td>${line.qty}</td>
                      <td>${this.formatMoney(line.unit_price)}</td>
                      <td>${this.formatMoney(line.total)}</td>
                      <td>${discount > 0 ? this.formatMoney(discount) : "-"}</td>
                      <td>فاتورة #${billId}</td>
                    </tr>
                  `
                )
                .join("");
              return billHeader + (lines || `<tr><td colspan="9">لا توجد بنود لهذه الفاتورة.</td></tr>`);
            })
            .join("");
          return groupHeader + billBlocks;
        })
        .join("");

      const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <title>تقرير ارباح الكاشير</title>
    <style>
      body { font-family: Cairo, "Segoe UI", Tahoma, sans-serif; margin: 24px; color: #0f172a; }
      .header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
      .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #0ea5e9; color: #fff; font-size: 12px; }
      h1, h2 { margin: 6px 0; }
      .meta { font-size: 12px; color: #334155; }
      .card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; margin: 16px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12.5px; }
      thead th { background: #e9f5ff; color: #0f172a; text-align: right; padding: 8px; border-bottom: 2px solid #0ea5e9; }
      tbody td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      .cashier-head td { background: #e0f2fe; color: #0f172a; font-weight: 700; border-bottom: 1px solid #bae6fd; }
      .bill-head td { background: #eef2ff; color: #1e293b; font-weight: 700; border-bottom: 1px solid #cbd5f5; }
      .footer { margin-top: 18px; font-size: 11px; color: #475569; }
      @page { size: A4; margin: 14mm; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <span class="badge">تقرير ارباح الكاشير</span>
        <h1>تفاصيل الارباح</h1>
        <div class="meta">الفترة: ${this.weekLabel}</div>
      </div>
      <div class="meta">
        <div>المسؤول: ${this.profile?.full_name || this.profile?.username || "-"}</div>
        <div>تاريخ الاصدار: ${this.formatDateTime(new Date())}</div>
      </div>
    </div>

    <div class="card">
      <h2>الاجمالي والصافي</h2>
      <div class="meta">الصافي بعد خصم تكلفة الاصناف</div>
      <table>
        <thead>
          <tr>
            <th>الكاشير</th>
            <th>اجمالي اليوم</th>
            <th>صافي اليوم</th>
            <th>اجمالي الاسبوع</th>
            <th>صافي الاسبوع</th>
            <th>اجمالي الشهر</th>
            <th>صافي الشهر</th>
          </tr>
        </thead>
        <tbody>
          ${reportRows || `<tr><td colspan="7">لا يوجد كاشير مسجل.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>فواتير الاسبوع</h2>
      <div class="meta">${this.weekLabel}</div>
      <table>
        <thead>
          <tr>
            <th>الوقت</th>
            <th>الكاشير</th>
            <th>الصنف</th>
            <th>النوع</th>
            <th>الكمية</th>
            <th>سعر الوحدة</th>
            <th>الاجمالي</th>
            <th>الخصم</th>
            <th>التفاصيل</th>
          </tr>
        </thead>
        <tbody>
          ${billsRows || `<tr><td colspan="8">لا توجد فواتير لهذا الاسبوع.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="footer">
      تم انشاء التقرير تلقائيا من نظام كاشير الحلاقة.
      <span>مبرمج ومصمم النظام .المهندس مهدي محمد</span>
    </div>
  </body>
</html>
      `;

      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    },
    subscribeRealtime() {
      supabase
        .channel("cashier-profit-live")
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
          { event: "*", schema: "public", table: "profiles" },
          () => this.loadCashiers()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "items" },
          () => {
            this.loadSoldOut();
            this.loadItemCosts();
          }
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
    await this.loadSoldOut();
    this.subscribeRealtime();
  },
};

createApp(app).mount("#app");
