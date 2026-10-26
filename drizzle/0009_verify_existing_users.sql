-- Email verification became mandatory for password sign-up (lib/auth.js).
-- Accounts created before that are grandfathered in, so existing password users
-- aren't locked out of sign-in. Only rows present when this runs are touched.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
