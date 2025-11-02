import { useCallback } from 'react';

/**
 * Hook for handling tool approval requests from Claude Agent API
 */
export const useToolApproval = (wsConnection, pendingApproval, setPendingApproval) => {

  const approveTool = useCallback((reason = 'Approved by user') => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    if (!pendingApproval) {
      console.error('No pending approval to approve');
      return;
    }

    try {
      // Send approval response in Claude Agent API format
      const response = {
        allow: 'yes'
      };

      wsConnection.send(JSON.stringify(response));
      console.log('Tool approved:', pendingApproval.tool_name, reason);

      // Clear pending approval
      setPendingApproval(null);
    } catch (error) {
      console.error('Error approving tool:', error);
    }
  }, [wsConnection, pendingApproval, setPendingApproval]);

  const denyTool = useCallback((reason = 'Denied by user') => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    if (!pendingApproval) {
      console.error('No pending approval to deny');
      return;
    }

    try {
      // Send denial response in Claude Agent API format
      const response = {
        allow: 'no'
      };

      wsConnection.send(JSON.stringify(response));
      console.log('Tool denied:', pendingApproval.tool_name, reason);

      // Clear pending approval
      setPendingApproval(null);
    } catch (error) {
      console.error('Error denying tool:', error);
    }
  }, [wsConnection, pendingApproval, setPendingApproval]);

  return {
    approveTool,
    denyTool
  };
};
