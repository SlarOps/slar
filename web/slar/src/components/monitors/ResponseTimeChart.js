'use client';

import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

/**
 * ResponseTimeChart - Line chart for response times using Chart.js
 */
export default function ResponseTimeChart({ data = [], height = 200 }) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500">
                No data available
            </div>
        );
    }

    // Prepare point colors based on check status
    const pointBackgroundColors = data.map(d => {
        // Check if the point represents a failed check
        // is_up can be boolean or 0/1
        const isFailed = d.is_up === false || d.is_up === 0 || d.status >= 400 || d.error;
        return isFailed ? 'rgb(239, 68, 68)' : 'rgb(59, 130, 246)'; // red for failed, blue for success
    });

    const pointBorderColors = data.map(d => {
        const isFailed = d.is_up === false || d.is_up === 0 || d.status >= 400 || d.error;
        return isFailed ? 'rgb(220, 38, 38)' : 'rgb(37, 99, 235)'; // darker red/blue for border
    });

    const chartData = {
        labels: data.map(d => d.time),
        datasets: [
            {
                label: 'Response Time (ms)',
                data: data.map(d => d.latency || 0),
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 1, // Thinner line
                fill: true,
                tension: 0.4,
                pointRadius: 0, // Hide points by default
                pointBackgroundColor: pointBackgroundColors,
                pointBorderColor: pointBorderColors,
                pointBorderWidth: 1,
                pointHoverRadius: 5, // Show on hover
                pointHoverBorderWidth: 2,
                segment: {
                    // Make line red between failed points
                    borderColor: (ctx) => {
                        const p0 = ctx.p0DataIndex;
                        const p1 = ctx.p1DataIndex;
                        const d0 = data[p0];
                        const d1 = data[p1];
                        const isFailed0 = d0?.is_up === false || d0?.is_up === 0 || d0?.status >= 400 || d0?.error;
                        const isFailed1 = d1?.is_up === false || d1?.is_up === 0 || d1?.status >= 400 || d1?.error;
                        // Red if either point is failed
                        return (isFailed0 || isFailed1) ? 'rgb(239, 68, 68)' : 'rgb(59, 130, 246)';
                    }
                }
            }
        ]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                borderColor: 'rgb(59, 130, 246)',
                borderWidth: 1,
                padding: 10,
                displayColors: false,
                callbacks: {
                    label: function (context) {
                        const dataPoint = data[context.dataIndex];
                        const latency = context.parsed.y;
                        const isFailed = dataPoint.is_up === false || dataPoint.is_up === 0 ||
                            dataPoint.status >= 400 || dataPoint.error;

                        let label = `${latency}ms`;

                        // Add status information
                        if (isFailed) {
                            label += ' ❌ Failed';
                            if (dataPoint.error) {
                                label += `\nError: ${dataPoint.error}`;
                            } else if (dataPoint.status) {
                                label += `\nHTTP ${dataPoint.status}`;
                            }
                        } else {
                            label += ' ✓ Success';
                            if (dataPoint.status) {
                                label += `\nHTTP ${dataPoint.status}`;
                            }
                        }

                        return label;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    color: '#9ca3af',
                    font: {
                        size: 11
                    },
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 8
                }
            },
            y: {
                beginAtZero: true,
                grid: {
                    color: 'rgba(156, 163, 175, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: '#9ca3af',
                    font: {
                        size: 11
                    },
                    callback: function (value) {
                        return value + 'ms';
                    }
                }
            }
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    };

    return (
        <div style={{ height: `${height}px` }} className="w-full">
            <Line data={chartData} options={options} />
        </div>
    );
}
