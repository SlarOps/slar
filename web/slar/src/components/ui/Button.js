import Link from 'next/link';

const baseClasses = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed rounded-full';

const variants = {
  solid: {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
    secondary: 'bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white',
    white: 'bg-white text-gray-900 hover:bg-gray-50 focus-visible:ring-gray-300',
  },
  outline: {
    primary: 'border border-blue-400 text-white hover:bg-blue-500/10 focus-visible:ring-blue-400',
    neutral: 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-300 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800',
  },
  ghost: {
    primary: 'text-blue-600 hover:bg-blue-50 focus-visible:ring-blue-400',
    neutral: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-300 dark:text-gray-200 dark:hover:bg-gray-800',
  }
};

const sizes = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-5 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
};

export default function Button({
  as = 'button',
  href,
  children,
  className,
  variant = 'solid',
  color = 'primary',
  size = 'md',
  ...props
}) {
  const classes = [baseClasses, sizes[size], variants[variant]?.[color], className].filter(Boolean).join(' ');

  if (as === 'link' || href) {
    return (
      <Link href={href || '#'} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}


