# SMTP Provider Contracts

Transactional e-mail (password reset link; legacy Supabase `auth.resetPasswordForEmail`). The worker sends
`smtp.email.send` through nodemailer only when `providers.smtp.live_mode` and the account `live_mode` are on.
Attempts store the masked recipient and the template name, never the subject or body.
