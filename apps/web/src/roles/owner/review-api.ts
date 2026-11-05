import {
  aiDecisionSchema,
  approvalOutcomeSchema,
  conversationItemSchema,
  paymentReviewItemSchema,
  paymentReviewResultSchema,
  type ApprovalChoice,
  type PaymentReviewAction,
} from '@buchi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useApi } from '../../components/api-context';
import { ownerKeys } from './owner-api';

/** The owner's review screens: payments, conversations, and AI decisions. */

export function usePaymentReviews(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.paymentReviews(shopId),
    queryFn: () => api.get(`/shops/${shopId}/payment-reviews`, z.array(paymentReviewItemSchema)),
  });
}

/** Fetched with the bearer token, which an `<img src>` cannot send. */
export function useScreenshot(shopId: string, proofId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...ownerKeys.paymentReviews(shopId), proofId, 'screenshot'],
    queryFn: () => api.blob(`/shops/${shopId}/payment-reviews/${proofId}/screenshot`),
    staleTime: Infinity,
  });
}

export function useDecidePayment(shopId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { proofId: string; action: PaymentReviewAction }) =>
      api.send(
        'POST',
        `/shops/${shopId}/payment-reviews/${input.proofId}/${input.action}`,
        {},
        paymentReviewResultSchema,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ownerKeys.paymentReviews(shopId) }),
  });
}

export function useConversations(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.conversations(shopId),
    queryFn: () => api.get(`/shops/${shopId}/conversations`, z.array(conversationItemSchema)),
  });
}

export function useSwitchConversation(shopId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; to: 'take-over' | 'hand-back' }) =>
      api.send(
        'POST',
        `/shops/${shopId}/conversations/${input.conversationId}/${input.to}`,
        {},
        conversationItemSchema,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ownerKeys.conversations(shopId) }),
  });
}

export function useAiDecisions(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.aiDecisions(shopId),
    queryFn: () => api.get(`/shops/${shopId}/ai-decisions`, z.array(aiDecisionSchema)),
  });
}

export function useDecideAi(shopId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { decisionId: string; choice: ApprovalChoice }) =>
      api.send(
        'POST',
        `/shops/${shopId}/ai-decisions/${input.decisionId}/${input.choice}`,
        {},
        approvalOutcomeSchema,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ownerKeys.aiDecisions(shopId) }),
  });
}
