import { supabase } from "./supabaseClient.js";

const cashierHoursMessage = "خارج مواعيد العمل الرسميه لا يمكنك تسجيل الدخول الان";
const cashierInactiveMessage = "هذا الحساب موقوف حاليا";

function getCairoHourMinute(date) {
  const timeZone = "Africa/Cairo";
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(date)
  );
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      minute: "2-digit",
      hour12: false,
    }).format(date)
  );
  return { hour, minute };
}

export function isWithinOperatingHours(date = new Date()) {
  const { hour, minute } = getCairoHourMinute(date);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 12 * 60 || totalMinutes < 6 * 60;
}

function enforceCashierHours(profile) {
  if (profile?.role !== "cashier") return;
  if (!isWithinOperatingHours()) {
    throw new Error(cashierHoursMessage);
  }
}

function enforceCashierActive(profile) {
  if (profile?.role !== "cashier") return;
  if (profile.active === false) {
    throw new Error(cashierInactiveMessage);
  }
}

export { cashierHoursMessage };
export { cashierInactiveMessage };

export async function signInWithUsername(username, password) {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error("اسم المستخدم مطلوب.");
  }

  const email = `${trimmed.toLowerCase()}@barbershop.local`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error("اسم المستخدم او كلمة المرور غير صحيحة.");
  }

  const userId = data.user?.id || data.session?.user?.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, username, full_name, active")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    throw new Error("ملف المستخدم غير موجود.");
  }

  if (profile.role === "cashier") {
    try {
      enforceCashierActive(profile);
      enforceCashierHours(profile);
    } catch (error) {
      await supabase.auth.signOut();
      throw error;
    }
  }

  return { session: data.session, profile };
}

export async function requireRole(requiredRole) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    redirectToLogin(requiredRole);
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, username, full_name, active")
    .eq("id", sessionData.session.user.id)
    .maybeSingle();

  if (error || !profile) {
    await supabase.auth.signOut();
    redirectToLogin(requiredRole);
    return null;
  }

  if (requiredRole && profile.role !== requiredRole) {
    await supabase.auth.signOut();
    redirectToLogin(requiredRole);
    return null;
  }

  if (profile.role === "cashier") {
    try {
      enforceCashierActive(profile);
      enforceCashierHours(profile);
    } catch (error) {
      await supabase.auth.signOut();
      redirectToLogin(requiredRole);
      return null;
    }
  }

  return profile;
}

export async function requireAnyRole(roles) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    redirectToLogin();
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, username, full_name, active")
    .eq("id", sessionData.session.user.id)
    .maybeSingle();

  if (error || !profile) {
    await supabase.auth.signOut();
    redirectToLogin();
    return null;
  }

  if (roles && !roles.includes(profile.role)) {
    await supabase.auth.signOut();
    redirectToLogin();
    return null;
  }

  if (profile.role === "cashier") {
    try {
      enforceCashierActive(profile);
      enforceCashierHours(profile);
    } catch (error) {
      await supabase.auth.signOut();
      redirectToLogin();
      return null;
    }
  }

  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function redirectToLogin(role) {
  window.location.href = "index.html";
}
