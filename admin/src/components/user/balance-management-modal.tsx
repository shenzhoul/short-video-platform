'use client';

import UpdateBalanceForm from '@components/user/update-balance-form';
// import { adminCustomerTransactionService } from '@services/customer-transaction.service';
import { appMessage as message } from '@lib/antd-message';
import { Modal } from 'antd';
import { useState } from 'react';
import { IUser } from 'src/interfaces';

interface IProps {
  user: IUser | null;
  visible: boolean;
  onCancel: () => void;
  onSuccess?: (result: any) => void;
}

/**
 * Balance Management Modal Component
 *
 * Provides a modal interface for admin balance adjustments with proper
 * form integration and error handling. Follows existing modal patterns
 * from the admin interface.
 *
 * Features:
 * - Enhanced balance form with notes and validation
 * - Proper loading states and error handling
 * - Success callbacks for parent component updates
 * - Consistent modal styling and behavior
 */
export function BalanceManagementModal({
  user,
  visible,
  onCancel,
  onSuccess = () => { }
}: IProps) {
  const [loading, setLoading] = useState(false);

  /**
   * Handle balance adjustment form submission
   * Calls the admin balance adjustment API and handles responses
   */
  // const handleBalanceAdjustment = async (payload: any) => {
  //   if (!user) {
  //     message.error('No user selected');
  //     return;
  //   }

  //   setLoading(true);
  //   try {
  //     // Call the admin balance adjustment API
  //     const result = await adminCustomerTransactionService.adjustUserBalance({
  //       userId: user._id,
  //       ...payload
  //     });

  //     const actionWord = payload.amount > 0 ? 'added' : 'deducted';
  //     const amountDisplay = Math.abs(payload.amount);
  //     const preposition = payload.amount > 0 ? 'to' : 'from';
  //     message.success(`Successfully ${actionWord} $${amountDisplay} ${preposition} ${user.name || user.username}'s balance`);

  //     // Call success callback if provided
  //     if (onSuccess) {
  //       onSuccess({
  //         userId: user._id,
  //         amount: payload.amount,
  //         newBalance: (parseFloat(user.balance) || 0) + payload.amount,
  //         transaction: result
  //       });
  //     }

  //     // Close modal
  //     onCancel();
  //   } catch (error: any) {
  //     message.error(error.message || 'Failed to adjust balance. Please try again.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  /**
   * Handle modal cancel
   * Resets form state and closes modal
   */
  const handleCancel = () => {
    if (loading) {
      return; // Prevent closing during API call
    }
    onCancel();
  };

  return (
    <Modal
      title={(
        <div>
          <span>Balance Management</span>
          {user ? (
            <div style={{ fontSize: '14px', fontWeight: 'normal', color: 'var(--color-main)', marginTop: '4px' }}>
              Managing balance for: <strong>{user.name || user.username}</strong>
            </div>
          ) : null}
        </div>
      )}
      open={visible}
      onCancel={handleCancel}
      footer={null} // Form handles its own submit button
      width={600}
      destroyOnHidden // Reset form state when modal closes
      mask={{ closable: !loading }} // Prevent closing during API call
      closable={!loading} // Disable close button during API call
      centered
    >
      {user ? (
        <UpdateBalanceForm
          // onFinish={handleBalanceAdjustment}
          // currentBalance={parseFloat(user.balance) || 0}
          updating={loading}
          userName={user.name || user.username}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          No user selected
        </div>
      )}
    </Modal>
  );
}

export default BalanceManagementModal;
