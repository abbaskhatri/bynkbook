INSERT INTO user_business_role (id, user_id, business_id, role, created_at, updated_at)
VALUES (gen_random_uuid(), '<USER_SUB>', '<BUSINESS_ID>', 'OWNER', now(), now())
ON CONFLICT DO NOTHING;
