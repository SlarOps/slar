import { XCircleIcon, CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/20/solid';

/**
 * Reusable Alert Component
 * 
 * @param {Object} props
 * @param {string} props.title - Alert title
 * @param {string} props.message - Alert message/content
 * @param {string} props.variant - 'success', 'error', 'warning', 'info'
 * @param {React.ReactNode} props.children - Optional custom content
 * @param {string} props.className - Additional classes
 */
export default function Alert({
    title,
    message,
    variant = 'info',
    children,
    className = ''
}) {
    const styles = {
        success: {
            bg: 'bg-green-50 dark:bg-green-900/20',
            text: 'text-green-800 dark:text-green-200',
            iconUrl: CheckCircleIcon,
            iconColor: 'text-green-400 dark:text-green-300'
        },
        error: {
            bg: 'bg-red-50 dark:bg-red-900/20',
            text: 'text-red-800 dark:text-red-200',
            iconUrl: XCircleIcon,
            iconColor: 'text-red-400 dark:text-red-300'
        },
        warning: {
            bg: 'bg-yellow-50 dark:bg-yellow-900/20',
            text: 'text-yellow-800 dark:text-yellow-200',
            iconUrl: ExclamationTriangleIcon,
            iconColor: 'text-yellow-400 dark:text-yellow-300'
        },
        info: {
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            text: 'text-blue-800 dark:text-blue-200',
            iconUrl: InformationCircleIcon,
            iconColor: 'text-blue-400 dark:text-blue-300'
        }
    };

    const style = styles[variant] || styles.info;
    const Icon = style.iconUrl;

    return (
        <div className={`rounded-md p-4 ${style.bg} ${className}`}>
            <div className="flex">
                <div className="flex-shrink-0">
                    <Icon className={`h-5 w-5 ${style.iconColor}`} aria-hidden="true" />
                </div>
                <div className="ml-3">
                    {title && (
                        <h3 className={`text-sm font-medium ${style.text}`}>
                            {title}
                        </h3>
                    )}
                    {message && (
                        <div className={`text-sm ${title ? 'mt-2' : ''} ${style.text}`}>
                            <p>{message}</p>
                        </div>
                    )}
                    {children && (
                        <div className={`text-sm ${title || message ? 'mt-2' : ''} ${style.text}`}>
                            {children}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
