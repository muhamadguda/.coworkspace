-- Trigger functions are never called over the API (advisor: security_definer_function_executable).
revoke execute on function public.trg_bundle_from_plan() from public, anon, authenticated;
revoke execute on function public.trg_expense_audit() from public, anon, authenticated;
