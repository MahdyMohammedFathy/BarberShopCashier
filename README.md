# BarberShop Cashier System

## What is included
- Cashier POS: create new bills, view daily bills, daily profit.
- Admin dashboard: profit per day, month, year.
- Admin items/services CRUD.
- Admin reports: bills and system users.
- Realtime updates via Supabase Realtime (no refresh needed).

## Setup
1. Create a Supabase project.
2. Run the SQL in [supabase/schema.sql](supabase/schema.sql).
3. Enable Realtime for tables: `items`, `services`, `bills`.
4. Create users in Supabase Auth using email format: `username@barbershop.local` (use lowercase usernames).
5. Insert a profile row for each user with the same `id` as `auth.users.id`.

Example profile insert:
```sql
insert into public.profiles (id, username, role, full_name)
values ('AUTH_USER_UUID', 'admin01', 'admin', 'Shop Admin');
```

## Frontend configuration
1. Update [assets/js/supabaseClient.js](assets/js/supabaseClient.js) with your Supabase URL and anon key.
2. Open `login.html` in a browser.

## Notes
- Login uses **username + password**. The app converts `username` to `username@barbershop.local` for Supabase Auth.
- Admin creation of users is not done in the UI to avoid exposing privileged keys on the frontend.
