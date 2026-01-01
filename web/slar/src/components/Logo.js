"use client";

import React from 'react';

const Logo = ({ size = 32, className = "", strokeColor = "currentColor" }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
    >
        <path
            d="M50 5 L 89 27.5 L 89 72.5 L 50 95 L 11 72.5 L 11 27.5 Z"
            stroke={strokeColor === "white" ? "white" : strokeColor}
            strokeWidth="6"
            strokeLinejoin="round"
            fill="none"
        />
        <path
            d="M58 25 L 42 50 H 54 L 42 75 L 60 45 H 48 Z"
            fill="#10B981"
            stroke="#10B981"
            strokeWidth="1"
            strokeLinejoin="round"
        />
    </svg>
);

export default Logo;
