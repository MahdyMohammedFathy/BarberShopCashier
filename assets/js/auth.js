import { supabase } from "./supabaseClient.js";

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
    .select("id, role, username, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    throw new Error("ملف المستخدم غير موجود.");
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
    .select("id, role, username, full_name")
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
    .select("id, role, username, full_name")
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

  return profile;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function redirectToLogin(role) {
  window.location.href = "index.html";
}
