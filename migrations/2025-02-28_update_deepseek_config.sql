-- Update DeepSeek-R1 model configuration to use temperature instead of reasoning_effort
UPDATE app_configurations
SET value = jsonb_set(
  value, 
  '{DeepSeek-R1,supports_temperature}', 
  'true'::jsonb
)
WHERE key = 'model_configs'
AND value ? 'DeepSeek-R1';
