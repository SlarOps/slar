"use client";

import Image from 'next/image';

const Logo = ({ size = 32, className = "" }) => (
    <Image
        src="/icon.svg"
        alt="SLAR"
        width={size}
        height={size}
        className={className}
    />
);

export default Logo;
