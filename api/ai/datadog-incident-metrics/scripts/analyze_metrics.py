#!/usr/bin/env python3
"""
Analyze Datadog metrics and generate incident report.

This script analyzes metrics data (from query_datadog.py) and generates
a markdown incident report with analysis, anomalies, and recommendations.
"""

import json
import sys
import argparse
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import statistics


class MetricsAnalyzer:
    """Analyze metrics data for incident troubleshooting."""

    # Thresholds for anomaly detection
    THRESHOLDS = {
        'cpu': {
            'high': 80.0,  # CPU > 80%
            'critical': 95.0  # CPU > 95%
        },
        'memory': {
            'high': 80.0,  # Memory > 80%
            'critical': 90.0  # Memory > 90%
        },
        'error_rate': {
            'high': 1.0,  # Error rate > 1%
            'critical': 5.0  # Error rate > 5%
        }
    }

    def __init__(self, data: Dict):
        """Initialize analyzer with metrics data."""
        self.data = data
        self.metadata = data.get('metadata', {})
        self.metrics = data.get('metrics', {})

    def calculate_stats(self, values: List[float]) -> Dict[str, float]:
        """Calculate statistics for a list of values."""
        if not values:
            return {}

        return {
            'min': min(values),
            'max': max(values),
            'avg': statistics.mean(values),
            'median': statistics.median(values),
            'stdev': statistics.stdev(values) if len(values) > 1 else 0.0,
            'count': len(values)
        }

    def extract_values(self, series: List[Dict]) -> List[float]:
        """Extract numeric values from series data."""
        values = []
        for s in series:
            for point_list in s.get('series', []):
                for point in point_list.get('pointlist', []):
                    if len(point) >= 2 and point[1] is not None:
                        values.append(float(point[1]))
        return values

    def detect_anomalies(
        self,
        metric_type: str,
        component: str,
        values: List[float]
    ) -> List[Dict]:
        """Detect anomalies in metric values."""
        anomalies = []

        if not values:
            return anomalies

        stats = self.calculate_stats(values)

        # Check against thresholds
        if metric_type in self.THRESHOLDS:
            thresholds = self.THRESHOLDS[metric_type]

            if stats['max'] >= thresholds.get('critical', float('inf')):
                anomalies.append({
                    'severity': 'CRITICAL',
                    'component': component,
                    'metric': metric_type,
                    'value': stats['max'],
                    'description': f"{metric_type.upper()} reached {stats['max']:.2f} (critical threshold: {thresholds['critical']})"
                })
            elif stats['max'] >= thresholds.get('high', float('inf')):
                anomalies.append({
                    'severity': 'HIGH',
                    'component': component,
                    'metric': metric_type,
                    'value': stats['max'],
                    'description': f"{metric_type.upper()} reached {stats['max']:.2f} (high threshold: {thresholds['high']})"
                })

            # Check if average is also high
            if stats['avg'] >= thresholds.get('high', float('inf')):
                anomalies.append({
                    'severity': 'HIGH',
                    'component': component,
                    'metric': metric_type,
                    'value': stats['avg'],
                    'description': f"Average {metric_type} is {stats['avg']:.2f} (sustained high usage)"
                })

        # Detect spikes (value significantly above average)
        if stats.get('stdev', 0) > 0:
            spike_threshold = stats['avg'] + (2 * stats['stdev'])
            if stats['max'] > spike_threshold:
                anomalies.append({
                    'severity': 'MEDIUM',
                    'component': component,
                    'metric': metric_type,
                    'value': stats['max'],
                    'description': f"{metric_type.upper()} spike detected: {stats['max']:.2f} (avg: {stats['avg']:.2f}, +2σ: {spike_threshold:.2f})"
                })

        return anomalies

    def analyze_all(self) -> Dict:
        """Analyze all metrics and return findings."""
        analysis = {
            'summary': {
                'total_components': len(self.metadata.get('components', [])),
                'total_metrics': sum(len(m) for m in self.metrics.values()),
                'time_range': self.metadata.get('time_range', {})
            },
            'components': {},
            'anomalies': [],
            'recommendations': []
        }

        # Analyze each metric type and component
        for metric_type, components_data in self.metrics.items():
            for component, series_list in components_data.items():
                if component not in analysis['components']:
                    analysis['components'][component] = {}

                # Extract and analyze values
                values = []
                for series_data in series_list:
                    series_values = []
                    for s in series_data.get('series', []):
                        for point in s.get('pointlist', []):
                            if len(point) >= 2 and point[1] is not None:
                                series_values.append(float(point[1]))
                    values.extend(series_values)

                if values:
                    stats = self.calculate_stats(values)
                    analysis['components'][component][metric_type] = {
                        'stats': stats,
                        'metric_name': series_list[0].get('metric', metric_type)
                    }

                    # Detect anomalies
                    anomalies = self.detect_anomalies(metric_type, component, values)
                    analysis['anomalies'].extend(anomalies)

        # Generate recommendations based on anomalies
        analysis['recommendations'] = self.generate_recommendations(analysis['anomalies'])

        # Sort anomalies by severity
        severity_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        analysis['anomalies'].sort(
            key=lambda x: severity_order.get(x['severity'], 99)
        )

        return analysis

    def generate_recommendations(self, anomalies: List[Dict]) -> List[str]:
        """Generate recommendations based on detected anomalies."""
        recommendations = []

        # Group anomalies by component and metric
        by_component = {}
        for anomaly in anomalies:
            component = anomaly['component']
            metric = anomaly['metric']

            if component not in by_component:
                by_component[component] = set()
            by_component[component].add(metric)

        # Generate recommendations
        for component, metrics in by_component.items():
            if 'cpu' in metrics and 'memory' in metrics:
                recommendations.append(
                    f"🔍 {component}: Both CPU and memory are elevated - check for resource leaks or excessive load"
                )
            elif 'cpu' in metrics:
                recommendations.append(
                    f"🔍 {component}: High CPU usage - investigate compute-intensive operations or infinite loops"
                )
            elif 'memory' in metrics:
                recommendations.append(
                    f"🔍 {component}: High memory usage - check for memory leaks or large data structures"
                )

            if 'error_rate' in metrics:
                recommendations.append(
                    f"🔍 {component}: Elevated error rate - check application logs for error details"
                )

            if 'rps' in metrics:
                recommendations.append(
                    f"🔍 {component}: Request rate anomaly - verify if traffic spike is expected"
                )

        if not recommendations:
            recommendations.append("✅ No significant anomalies detected in the analyzed metrics")

        return recommendations


def generate_markdown_report(analysis: Dict, metadata: Dict) -> str:
    """Generate markdown incident report."""

    report = []

    # Header
    report.append("# Incident Metrics Analysis Report")
    report.append("")
    report.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    report.append("")

    # Incident details
    report.append("## Incident Details")
    report.append("")
    report.append(f"- **Incident Time:** {metadata.get('incident_time', 'N/A')}")

    time_range = metadata.get('time_range', {})
    report.append(f"- **Analysis Window:** {time_range.get('from', 'N/A')} to {time_range.get('to', 'N/A')}")
    report.append(f"- **Components Analyzed:** {', '.join(metadata.get('components', []))}")
    report.append(f"- **Metric Types:** {', '.join(metadata.get('metric_types', []))}")
    report.append("")

    # Summary
    summary = analysis.get('summary', {})
    report.append("## Summary")
    report.append("")
    report.append(f"- **Total Components:** {summary.get('total_components', 0)}")
    report.append(f"- **Total Metrics Collected:** {summary.get('total_metrics', 0)}")
    report.append(f"- **Anomalies Detected:** {len(analysis.get('anomalies', []))}")
    report.append("")

    # Anomalies
    anomalies = analysis.get('anomalies', [])
    if anomalies:
        report.append("## 🚨 Detected Anomalies")
        report.append("")

        # Group by severity
        critical = [a for a in anomalies if a['severity'] == 'CRITICAL']
        high = [a for a in anomalies if a['severity'] == 'HIGH']
        medium = [a for a in anomalies if a['severity'] == 'MEDIUM']

        if critical:
            report.append("### 🔴 CRITICAL")
            report.append("")
            for anomaly in critical:
                report.append(f"- **{anomaly['component']}**: {anomaly['description']}")
            report.append("")

        if high:
            report.append("### 🟠 HIGH")
            report.append("")
            for anomaly in high:
                report.append(f"- **{anomaly['component']}**: {anomaly['description']}")
            report.append("")

        if medium:
            report.append("### 🟡 MEDIUM")
            report.append("")
            for anomaly in medium:
                report.append(f"- **{anomaly['component']}**: {anomaly['description']}")
            report.append("")
    else:
        report.append("## ✅ No Anomalies Detected")
        report.append("")

    # Metrics details by component
    report.append("## 📊 Metrics Details")
    report.append("")

    components = analysis.get('components', {})
    for component, metrics in components.items():
        report.append(f"### {component}")
        report.append("")

        # Create table
        report.append("| Metric | Min | Max | Avg | Median | StdDev |")
        report.append("|--------|-----|-----|-----|--------|--------|")

        for metric_type, data in metrics.items():
            stats = data.get('stats', {})
            report.append(
                f"| {metric_type} | "
                f"{stats.get('min', 0):.2f} | "
                f"{stats.get('max', 0):.2f} | "
                f"{stats.get('avg', 0):.2f} | "
                f"{stats.get('median', 0):.2f} | "
                f"{stats.get('stdev', 0):.2f} |"
            )

        report.append("")

    # Recommendations
    recommendations = analysis.get('recommendations', [])
    if recommendations:
        report.append("## 💡 Recommendations")
        report.append("")
        for rec in recommendations:
            report.append(f"- {rec}")
        report.append("")

    # Footer
    report.append("---")
    report.append("")
    report.append("*Report generated by Datadog Incident Metrics Analyzer*")

    return '\n'.join(report)


def main():
    parser = argparse.ArgumentParser(
        description='Analyze Datadog metrics and generate incident report'
    )

    parser.add_argument(
        'input',
        type=str,
        help='Input JSON file from query_datadog.py (or "-" for stdin)'
    )

    parser.add_argument(
        '--output',
        type=str,
        help='Output markdown file path (default: stdout)'
    )

    parser.add_argument(
        '--format',
        type=str,
        choices=['markdown', 'json'],
        default='markdown',
        help='Output format (default: markdown)'
    )

    args = parser.parse_args()

    # Read input data
    if args.input == '-':
        data = json.load(sys.stdin)
    else:
        with open(args.input, 'r') as f:
            data = json.load(f)

    # Analyze metrics
    analyzer = MetricsAnalyzer(data)
    analysis = analyzer.analyze_all()

    # Generate report
    if args.format == 'markdown':
        output = generate_markdown_report(analysis, data.get('metadata', {}))
    else:
        output = json.dumps(analysis, indent=2)

    # Write output
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
        print(f"✓ Report saved to: {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == '__main__':
    main()
