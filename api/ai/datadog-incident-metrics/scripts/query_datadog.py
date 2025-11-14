#!/usr/bin/env python3
"""
Query Datadog metrics for incident analysis.

This script queries Datadog API for key metrics (CPU, memory, error rate, RPS)
for specified components/services during an incident time window.
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import urllib.request
import urllib.parse
import urllib.error


class DatadogMetricsQuery:
    """Query Datadog metrics for incident analysis."""

    # Common metric patterns for different resource types
    METRIC_PATTERNS = {
        'cpu': [
            'system.cpu.user',
            'system.cpu.system',
            'system.cpu.idle',
            'aws.ec2.cpuutilization',
            'kubernetes.cpu.usage.total',
            'container.cpu.usage',
        ],
        'memory': [
            'system.mem.used',
            'system.mem.usable',
            'system.mem.pct_usable',
            'aws.ec2.memory_utilization',
            'kubernetes.memory.usage',
            'container.memory.usage',
        ],
        'error_rate': [
            'trace.*.errors',
            'error.count',
            'http.status_code.4xx',
            'http.status_code.5xx',
            'application.errors',
        ],
        'rps': [
            'trace.*.hits',
            'requests.count',
            'http.requests',
            'nginx.requests.total',
            'application.requests_per_second',
        ]
    }

    def __init__(self, api_key: str, app_key: str, site: str = 'datadoghq.eu'):
        """Initialize Datadog API client.

        Args:
            api_key: Datadog API key
            app_key: Datadog application key
            site: Datadog site (default: datadoghq.eu, can be datadoghq.com)
        """
        self.api_key = api_key
        self.app_key = app_key
        self.base_url = f"https://api.{site}"

    def query_metric(
        self,
        query: str,
        from_ts: int,
        to_ts: int
    ) -> Dict:
        """Query a single metric from Datadog.

        Args:
            query: Metric query (e.g., "avg:system.cpu.user{service:api}")
            from_ts: Start timestamp (Unix seconds)
            to_ts: End timestamp (Unix seconds)

        Returns:
            Dict with query results
        """
        url = f"{self.base_url}/api/v1/query"
        params = {
            'query': query,
            'from': from_ts,
            'to': to_ts
        }

        url_with_params = f"{url}?{urllib.parse.urlencode(params)}"

        req = urllib.request.Request(url_with_params)
        req.add_header('DD-API-KEY', self.api_key)
        req.add_header('DD-APPLICATION-KEY', self.app_key)

        try:
            with urllib.request.urlopen(req) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            raise Exception(f"Datadog API error: {e.code} - {error_body}")

    def build_queries(
        self,
        components: List[str],
        metric_types: List[str],
        tag_filters: Optional[Dict[str, str]] = None
    ) -> Dict[str, List[str]]:
        """Build Datadog metric queries for components.

        Args:
            components: List of service/component names
            metric_types: List of metric types to query (cpu, memory, error_rate, rps)
            tag_filters: Optional dict of tag filters (e.g., {"env": "production"})

        Returns:
            Dict mapping metric type to list of queries
        """
        queries = {}

        for metric_type in metric_types:
            if metric_type not in self.METRIC_PATTERNS:
                continue

            queries[metric_type] = []

            for component in components:
                for metric in self.METRIC_PATTERNS[metric_type]:
                    # Build tag filter string
                    tags = [f"service:{component}"]
                    if tag_filters:
                        tags.extend([f"{k}:{v}" for k, v in tag_filters.items()])

                    tag_str = ','.join(tags)

                    # Try different aggregations
                    queries[metric_type].append(f"avg:{metric}{{{tag_str}}}")

        return queries

    def query_incident_metrics(
        self,
        components: List[str],
        incident_time: datetime,
        metric_types: List[str] = ['cpu', 'memory', 'error_rate', 'rps'],
        before_minutes: int = 30,
        after_minutes: int = 30,
        tag_filters: Optional[Dict[str, str]] = None
    ) -> Dict:
        """Query all metrics for incident analysis.

        Args:
            components: List of service/component names
            incident_time: Incident start time
            metric_types: Types of metrics to query
            before_minutes: Minutes before incident to include
            after_minutes: Minutes after incident to include
            tag_filters: Optional dict of tag filters

        Returns:
            Dict with all metric results organized by component and metric type
        """
        # Calculate time range
        start_time = incident_time - timedelta(minutes=before_minutes)
        end_time = incident_time + timedelta(minutes=after_minutes)

        from_ts = int(start_time.timestamp())
        to_ts = int(end_time.timestamp())

        print(f"Querying metrics from {start_time} to {end_time}")
        print(f"Components: {', '.join(components)}")
        print(f"Metric types: {', '.join(metric_types)}")
        print()

        # Build queries
        queries = self.build_queries(components, metric_types, tag_filters)

        # Execute queries
        results = {
            'metadata': {
                'components': components,
                'incident_time': incident_time.isoformat(),
                'time_range': {
                    'from': start_time.isoformat(),
                    'to': end_time.isoformat(),
                    'from_ts': from_ts,
                    'to_ts': to_ts
                },
                'metric_types': metric_types
            },
            'metrics': {}
        }

        for metric_type, query_list in queries.items():
            results['metrics'][metric_type] = {}

            for query in query_list:
                print(f"Querying: {query}")

                try:
                    result = self.query_metric(query, from_ts, to_ts)

                    # Store result if it has data
                    if result.get('series'):
                        # Extract component name from query
                        component = self._extract_component(query, components)
                        metric_name = self._extract_metric_name(query)

                        if component not in results['metrics'][metric_type]:
                            results['metrics'][metric_type][component] = []

                        results['metrics'][metric_type][component].append({
                            'metric': metric_name,
                            'query': query,
                            'series': result['series']
                        })
                        print(f"  ✓ Found data for {component} - {metric_name}")
                    else:
                        print(f"  ✗ No data")

                except Exception as e:
                    print(f"  ✗ Error: {str(e)}")

        return results

    def _extract_component(self, query: str, components: List[str]) -> str:
        """Extract component name from query."""
        for component in components:
            if f"service:{component}" in query:
                return component
        return "unknown"

    def _extract_metric_name(self, query: str) -> str:
        """Extract metric name from query."""
        # Extract from "avg:metric.name{tags}"
        parts = query.split(':')
        if len(parts) > 1:
            metric = parts[1].split('{')[0]
            return metric
        return query


def parse_datetime(dt_str: str) -> datetime:
    """Parse datetime string in various formats."""
    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%dT%H:%M',
    ]

    for fmt in formats:
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue

    # Try parsing relative time (e.g., "30m ago", "2h ago")
    if 'ago' in dt_str:
        parts = dt_str.replace('ago', '').strip().split()
        if len(parts) == 2:
            amount = int(parts[0])
            unit = parts[1]

            if unit in ['m', 'min', 'minute', 'minutes']:
                return datetime.now() - timedelta(minutes=amount)
            elif unit in ['h', 'hr', 'hour', 'hours']:
                return datetime.now() - timedelta(hours=amount)

    raise ValueError(f"Unable to parse datetime: {dt_str}")


def main():
    parser = argparse.ArgumentParser(
        description='Query Datadog metrics for incident analysis'
    )

    parser.add_argument(
        '--components',
        type=str,
        required=True,
        help='Comma-separated list of components/services (e.g., "api-gateway,auth-service")'
    )

    parser.add_argument(
        '--incident-time',
        type=str,
        default='now',
        help='Incident time (YYYY-MM-DD HH:MM:SS, "30m ago", or "now")'
    )

    parser.add_argument(
        '--metrics',
        type=str,
        default='cpu,memory,error_rate,rps',
        help='Comma-separated metric types to query'
    )

    parser.add_argument(
        '--before',
        type=int,
        default=30,
        help='Minutes before incident to query (default: 30)'
    )

    parser.add_argument(
        '--after',
        type=int,
        default=30,
        help='Minutes after incident to query (default: 30)'
    )

    parser.add_argument(
        '--tags',
        type=str,
        help='Additional tag filters (e.g., "env:production,region:us-east-1")'
    )

    parser.add_argument(
        '--output',
        type=str,
        help='Output file path (default: stdout)'
    )

    parser.add_argument(
        '--api-key',
        type=str,
        default=os.getenv('DD_API_KEY'),
        help='Datadog API key (or set DD_API_KEY env var)'
    )

    parser.add_argument(
        '--app-key',
        type=str,
        default=os.getenv('DD_APP_KEY'),
        help='Datadog application key (or set DD_APP_KEY env var)'
    )

    parser.add_argument(
        '--site',
        type=str,
        default=os.getenv('DD_SITE', 'datadoghq.eu'),
        help='Datadog site (default: datadoghq.eu)'
    )

    args = parser.parse_args()

    # Validate credentials
    if not args.api_key or not args.app_key:
        print("Error: Datadog API credentials required", file=sys.stderr)
        print("Set DD_API_KEY and DD_APP_KEY environment variables", file=sys.stderr)
        print("Or use --api-key and --app-key arguments", file=sys.stderr)
        sys.exit(1)

    # Parse inputs
    components = [c.strip() for c in args.components.split(',')]
    metric_types = [m.strip() for m in args.metrics.split(',')]

    # Parse incident time
    if args.incident_time.lower() == 'now':
        incident_time = datetime.now()
    else:
        incident_time = parse_datetime(args.incident_time)

    # Parse tag filters
    tag_filters = None
    if args.tags:
        tag_filters = {}
        for tag in args.tags.split(','):
            key, value = tag.split(':', 1)
            tag_filters[key.strip()] = value.strip()

    # Query metrics
    client = DatadogMetricsQuery(args.api_key, args.app_key, args.site)

    results = client.query_incident_metrics(
        components=components,
        incident_time=incident_time,
        metric_types=metric_types,
        before_minutes=args.before,
        after_minutes=args.after,
        tag_filters=tag_filters
    )

    # Output results
    output_json = json.dumps(results, indent=2)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"\n✓ Results saved to: {args.output}")
    else:
        print("\n" + "="*80)
        print("RESULTS")
        print("="*80)
        print(output_json)


if __name__ == '__main__':
    main()
