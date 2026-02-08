import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabaseUrl = "https://ybogwhbvkmllgudqkztf.supabase.co";
export const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlib2d3aGJ2a21sbGd1ZHFrenRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDQyMzMsImV4cCI6MjA4NjEyMDIzM30.d3VXNENSwPbPBqrcpxVBYJRR3wkiLRSprhYg20EPIcU";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
