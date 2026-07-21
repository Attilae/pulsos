# Administrative access and complimentary Pro grants

Authorization and billing are deliberately separate:

- `user.role = 'superadmin'` grants unmetered access to every monetized feature.
- `entitlement_overrides` grants normal Pro access, including the monthly Pro AI allowance,
  without creating a fake Lemon Squeezy subscription.
- Everyone else is resolved from their Lemon Squeezy subscription.

Run the database migrations before using these commands.

## Promote a superadmin

Use the exact account email:

```sql
update "user"
set role = 'superadmin', updated_at = now()
where email = 'owner@example.com';
```

Demote the account without affecting any real subscription:

```sql
update "user"
set role = 'user', updated_at = now()
where email = 'owner@example.com';
```

The role is registered with Better Auth as a non-input field, so it cannot be changed through
sign-up or profile-update requests.

## Grant complimentary Pro

The following grant does not expire. `granted_by` is optional but recommended for the audit
trail:

```sql
insert into entitlement_overrides (user_id, plan, reason, granted_by)
select recipient.id, 'pro', 'Partner access', admin.id
from "user" recipient
join "user" admin on admin.email = 'owner@example.com'
where recipient.email = 'recipient@example.com'
on conflict (user_id) do update set
  plan = excluded.plan,
  expires_at = null,
  reason = excluded.reason,
  granted_by = excluded.granted_by,
  updated_at = now();
```

For an expiring grant, add an `expires_at` value such as `now() + interval '30 days'` to both
the insert columns and conflict update. Revoke a grant with:

```sql
delete from entitlement_overrides
where user_id = (select id from "user" where email = 'recipient@example.com');
```

Changes take effect the next time the client refreshes `/api/entitlements` or reloads the app.
