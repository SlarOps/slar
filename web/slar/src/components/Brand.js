"use client";

import Link from "next/link";
import Logo from "./Logo";

export const Brand = ({ size = 28, showText = true, withLink = false, className = "" }) => {
    const content = (
        <div className={`flex items-center ${className}`}>
            <div className="flex items-center justify-center">
                <Logo size={size} />
            </div>
            {showText && (
                <span className="text-xl font-black tracking-tighter text-gray-900 dark:text-white">
                    slar<span className="text-emerald-500">.</span>
                </span>
            )}
        </div>
    );

    if (withLink) {
        return <Link href="/">{content}</Link>;
    }

    return content;
};

export default Brand;
