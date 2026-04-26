'use client';

import axios, { AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STORAGE_TOKEN = 'contbet_token';

export const api: AxiosInstance = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(STORAGE_TOKEN);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_TOKEN);
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname === '/') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export const setToken = (t: string | null) => {
  if (typeof window === 'undefined') return;
  if (t) localStorage.setItem(STORAGE_TOKEN, t);
  else localStorage.removeItem(STORAGE_TOKEN);
};

export const getToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_TOKEN);
};
