import Button from '../ui/Button';
import { NewSessionIcon } from '../ui/Icons';

export const SessionInfo = ({ sessionId, onSessionReset }) => {
  if (!sessionId) {
    return null;
  }

  return (
    <div className="flex justify-end">
      <Button
        onClick={onSessionReset}
        variant="ghost"
        color="neutral"
        size="sm"
        className="!text-red-600 dark:!text-red-400 
                   hover:!text-red-500 hover:!bg-red-50 
                   dark:hover:!text-red-300 dark:hover:!bg-red-900/20 
                   focus-visible:!ring-red-500 !rounded-md !px-2 sm:!px-3 !py-1 bg-red-100 
                   whitespace-nowrap !text-[10px] sm:!text-xs"
        title="Start new conversation"
      >
        <span className="hidden sm:inline">New Session</span>
        <span className="sm:hidden">New</span>
      </Button>
    </div>
  );
};
