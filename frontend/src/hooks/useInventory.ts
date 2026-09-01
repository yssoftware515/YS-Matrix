'use client';

// ============================================================
// YS-MATRIX ERP — useInventory Hook
//
// Minimal hook (search/list only) — created to satisfy
// SaleCreateModal's item-picker. Returns Paginated<InventoryItem>
// directly via inventoryApi.getAll, matching the V2 api.ts shape
// (no AxiosResponse / r.data.data unwrapping needed).
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { inventoryApi, type InventoryParams } from '@/lib/api';

export function useInventory(params?: InventoryParams) {
  return useQuery({
    queryKey: ['inventory-picker', params],
    queryFn:  () => inventoryApi.getAll(params),
  });
}
