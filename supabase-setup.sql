-- Plan de mttos PBS · preparación de Supabase
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → pegar todo → Run.

-- 1) Tabla donde se guardan equipos, avances, bitácora, firmas, cuentas y configuración
create table if not exists public.mttos_docs (
  c          text        not null,
  id         text        not null,
  d          jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (c, id)
);

-- 2) Seguridad: se activa RLS y NO se crea ninguna política.
--    Así nadie puede leer ni escribir con las llaves públicas; solo el servidor, con la llave secreta.
alter table public.mttos_docs enable row level security;

-- 3) Bucket privado para las evidencias (PDF/JPG). Sin acceso público.
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidencias', 'evidencias', false, 10485760)
on conflict (id) do nothing;
