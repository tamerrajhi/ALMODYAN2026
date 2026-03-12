/**
 * POS Request Logger
 * 
 * Provides centralized logging for all POS workflow attempts to ensure
 * no silent failures - every attempt is logged to pos_workflow_requests table.
 * 
 * Workflow types:
 * - pos_sale
 * - pos_return
 * - pos_credit_note
 * - customer_receipt
 */

import * as dataGateway from '@/lib/dataGateway';

export type PosWorkflowType = 
  | 'pos_sale' 
  | 'pos_return' 
  | 'pos_credit_note' 
  | 'customer_receipt';

export interface PosAttemptStartParams {
  clientRequestId: string;
  workflowType: PosWorkflowType;
  payload: any;
}

export interface PosAttemptFailParams {
  clientRequestId: string;
  errorCode: string;
  errorMessage: string;
}

export interface PosAttemptSuccessParams {
  clientRequestId: string;
  entityId: string;
  result: any;
}

export interface PosBeginResult {
  idempotent: boolean;
  status: string;
  retry?: boolean;
  entity_id?: string;
  result?: Record<string, unknown>;
}

/**
 * Log the start of a POS workflow attempt.
 * Must be called BEFORE any validation guards.
 * 
 * @returns Result indicating if this is an idempotent replay or new attempt
 */
export async function logPosAttemptStart(
  params: PosAttemptStartParams
): Promise<PosBeginResult | null> {
  try {
    const { data, error } = await dataGateway.posBeginRequest({
      clientRequestId: params.clientRequestId,
      workflowType: params.workflowType,
      payload: params.payload,
    });

    if (error) {
      if (error.message?.includes('CONFLICT_IN_PROGRESS')) {
        console.warn('[POS Logger] Request already processing:', params.clientRequestId);
        return { idempotent: false, status: 'conflict' };
      }
      console.error('[POS Logger] Failed to log attempt start:', error);
      return null;
    }

    return data as PosBeginResult;
  } catch (err) {
    console.error('[POS Logger] Exception logging attempt start:', err);
    return null;
  }
}

/**
 * Log a failed POS workflow attempt (guard failure or RPC error).
 * Creates or updates the request record with failed status.
 */
export async function logPosAttemptFail(
  params: PosAttemptFailParams
): Promise<void> {
  try {
    const { error } = await dataGateway.posFailRequest({
      clientRequestId: params.clientRequestId,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });

    if (error) {
      console.error('[POS Logger] Failed to log attempt failure:', error);
    } else {
      console.log('[POS Logger] Logged failure:', params.errorCode);
    }
  } catch (err) {
    console.error('[POS Logger] Exception logging attempt failure:', err);
  }
}

/**
 * Log a successful POS workflow completion.
 * Updates the request record with succeeded status and entity reference.
 */
export async function logPosAttemptSuccess(
  params: PosAttemptSuccessParams
): Promise<void> {
  try {
    const { error } = await dataGateway.posSucceedRequest({
      clientRequestId: params.clientRequestId,
      entityId: params.entityId,
      result: params.result,
    });

    if (error) {
      console.error('[POS Logger] Failed to log attempt success:', error);
    } else {
      console.log('[POS Logger] Logged success for entity:', params.entityId);
    }
  } catch (err) {
    console.error('[POS Logger] Exception logging attempt success:', err);
  }
}

/**
 * Standard POS error codes for guard failures
 */
export const POS_ERROR_CODES = {
  // Sale guards
  SELLER_REQUIRED: 'SELLER_REQUIRED',
  BRANCH_REQUIRED: 'BRANCH_REQUIRED',
  CART_EMPTY: 'CART_EMPTY',
  INVALID_PHONE: 'INVALID_PHONE',
  MISSING_CLIENT_REQUEST_ID: 'MISSING_CLIENT_REQUEST_ID',
  
  // Return guards
  SALE_NOT_SELECTED: 'SALE_NOT_SELECTED',
  NO_ITEMS_TO_RETURN: 'NO_ITEMS_TO_RETURN',
  REFUND_METHOD_REQUIRED: 'REFUND_METHOD_REQUIRED',
  POST_RETURN_STATUS_REQUIRED: 'POST_RETURN_STATUS_REQUIRED',
  
  // Credit note guards
  CUSTOMER_REQUIRED: 'CUSTOMER_REQUIRED',
  
  // Receipt guards  
  AMOUNT_REQUIRED: 'AMOUNT_REQUIRED',
  OVERPAY_NOT_ALLOWED: 'OVERPAY_NOT_ALLOWED',
  
  // RPC errors
  RPC_ERROR: 'RPC_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type PosErrorCode = typeof POS_ERROR_CODES[keyof typeof POS_ERROR_CODES];
