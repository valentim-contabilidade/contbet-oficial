// Tipos e enums compartilhados entre frontend e backend

export enum Profile {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  OWNER = 'OWNER',
}

export enum Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface Auditable {
  id: string;
  created_at: string;
  updated_at: string;
  metadeleted: boolean;
}

export interface User extends Auditable {
  name: string;
  username: string;
  email: string;
  profile: Profile;
  status: Status;
  company_id: string | null;
  brand_id: string | null;
}

export interface Company extends Auditable {
  name: string;
  cnpj: string;
  address: string | null;
  city: string;
  state: string;
  logo: string | null; // base64
}

export interface Brand extends Auditable {
  name: string;
  domain: string | null;
  description: string | null;
  status: Status;
  company_id: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}
