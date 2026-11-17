import { create } from "zustand";
import { api } from "../lib/bridge";
import type { ApprovalRequest } from "../types";

interface ApprovalStore {
  pending: ApprovalRequest[];
  push: (request: ApprovalRequest) => void;
  resolve: (approvalId: string, approved: boolean) => Promise<void>;
  clear: (requestId?: string) => void;
}

export const useApprovalStore = create<ApprovalStore>((set) => ({
  pending: [],

  push: (request) =>
    set((state) =>
      state.pending.some((p) => p.approvalId === request.approvalId)
        ? state
        : { pending: [...state.pending, request] },
    ),

  resolve: async (approvalId, approved) => {
    set((state) => ({
      pending: state.pending.filter((p) => p.approvalId !== approvalId),
    }));
    try {
      await api.connectorApprove(approvalId, approved);
    } catch {
      /* the request will time out on the backend */
    }
  },

  clear: (requestId) =>
    set((state) => ({
      pending: requestId
        ? state.pending.filter((p) => p.requestId !== requestId)
        : [],
    })),
}));
