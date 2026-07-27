-- Manually reset a user's password (dev or prod).
--
-- Step 1 - generate a bcrypt hash for the new password. From /backend:
--   node -e "require('bcrypt').hash(process.argv[1],10).then(console.log)" "TheNewPassword"
--
-- Step 2 - paste the hash below and run against the target ai_insight database.
--          The hash starts with $2b$10$ and is 60 chars. Do NOT edit it by hand.

DECLARE @email        nvarchar(256) = N'user@example.com';
DECLARE @passwordHash nvarchar(255) = N'$2b$10$REPLACE_WITH_GENERATED_HASH';

-- Sanity check: exactly one row, and the hash looks like bcrypt.
IF (SELECT COUNT(*) FROM app.account WHERE email = @email) <> 1
    THROW 50000, 'Expected exactly one account for that email', 1;

IF @passwordHash NOT LIKE '$2[aby]$1[0-9]$%' OR LEN(@passwordHash) <> 60
    THROW 50000, 'passwordHash does not look like a bcrypt hash', 1;

UPDATE app.account
SET password_hash      = @passwordHash,
    -- kill any live session so the old password/refresh token stops working
    refresh_token_hash = NULL,
    session_expires_at = NULL,
    modified           = GETDATE()
WHERE email = @email;

SELECT id, email, display_name, last_login_date, session_expires_at
FROM app.account
WHERE email = @email;
