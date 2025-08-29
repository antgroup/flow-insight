#!/usr/bin/env python3
"""
Flow Insight Visualization Demo
"""

import time
from typing import List, Dict, Any

# Import the visualization module
from flow_insight.visualize import register_module, configure_insight_client

# Configure the insight client
configure_insight_client("demo-flow","http://localhost:8000")

# Create a sample module to instrument
class DataProcessor:
    """A sample service class for processing data."""
    
    def __init__(self, name: str):
        self.name = name
    
    def process_data(self, data: List[int], multiplier: int = 1) -> List[int]:
        """Process data by multiplying each element."""
        time.sleep(1)  # Simulate processing
        return [x * multiplier for x in data]
    
    def filter_data(self, data: List[int], threshold: int = 10) -> List[int]:
        """Filter data by threshold."""
        time.sleep(1)
        return [x for x in data if x > threshold]
    

class AnalyticsEngine:
    """Another sample service for analytics."""
    
    def __init__(self, engine_name: str):
        self.engine_name = engine_name
    
    def calculate_stats(self, data: List[int]) -> Dict[str, float]:
        """Calculate statistics for data."""
        time.sleep(0.01)
        if not data:
            return {"mean": 0.0, "sum": 0.0, "count": 0}
        
        return {
            "mean": sum(data) / len(data),
            "sum": float(sum(data)),
            "count": float(len(data))
        }
    
    def generate_report(self, stats: Dict[str, float]) -> str:
        """Generate a report from statistics."""
        time.sleep(0.01)
        return f"Report: mean={stats['mean']:.2f}, sum={stats['sum']}, count={stats['count']}"


class ReportGenerator:
    """Nested service for generating different types of reports."""
    
    def __init__(self, format_type: str):
        self.format_type = format_type
        self.template_engine = TemplateEngine()
        self.data_formatter = DataFormatter()
    
    def create_detailed_report(self, data: List[int], stats: Dict[str, float]) -> Dict[str, Any]:
        """Create a detailed report with multiple formats."""
        formatted_data = self.data_formatter.format_data(data)
        template = self.template_engine.load_template("detailed_report")
        
        report = {
            "format": self.format_type,
            "data_summary": formatted_data,
            "statistics": stats,
            "template_used": template,
            "timestamp": time.time()
        }
        return report


class TemplateEngine:
    """Nested service for managing templates."""
    
    def __init__(self):
        self.templates = {}
    
    def load_template(self, template_name: str) -> str:
        """Load a template by name."""
        if template_name not in self.templates:
            self.templates[template_name] = f"Template: {template_name}"
        return self.templates[template_name]
    
    def render_template(self, template_name: str, context: Dict[str, Any]) -> str:
        """Render a template with context data."""
        template = self.load_template(template_name)
        return f"Rendered: {template} with {len(context)} variables"


class DataFormatter:
    """Nested service for formatting data."""
    
    def __init__(self):
        self.formatters = {"json": self._format_json, "csv": self._format_csv}
    
    def format_data(self, data: List[int]) -> Dict[str, Any]:
        """Format data into multiple formats."""
        return {
            "json": self._format_json(data),
            "csv": self._format_csv(data),
            "summary": self._create_summary(data)
        }
    
    def _format_json(self, data: List[int]) -> str:
        """Format data as JSON."""
        return f"json:{len(data)} items"
    
    def _format_csv(self, data: List[int]) -> str:
        """Format data as CSV."""
        return f"csv:{','.join(map(str, data[:5]))}..." if len(data) > 5 else f"csv:{','.join(map(str, data))}"
    
    def _create_summary(self, data: List[int]) -> Dict[str, int]:
        """Create data summary."""
        return {"min": min(data) if data else 0, "max": max(data) if data else 0, "count": len(data)}


class WorkflowOrchestrator:
    """High-level orchestrator for complex workflows."""
    
    def __init__(self):
        self.processors = {}
        self.analytics = {}
    
    def register_processor(self, name: str, processor: DataProcessor):
        """Register a data processor."""
        self.processors[name] = processor
    
    def register_analytics(self, name: str, analytics: AnalyticsEngine):
        """Register an analytics engine."""
        self.analytics[name] = analytics
    
    def run_complex_workflow(self, data: List[int], config: Dict[str, Any]) -> Dict[str, Any]:
        """Run a complex multi-step workflow."""
        # Step 1: Process with multiple processors
        results = {}
        for proc_name, processor in self.processors.items():
            multiplier = config.get("multipliers", {}).get(proc_name, 1)
            results[proc_name] = processor.process_data(data, multiplier=multiplier)
        
        # Step 2: Filter results
        filtered_results = {}
        for proc_name, result in results.items():
            threshold = config.get("thresholds", {}).get(proc_name, 10)
            filtered_results[proc_name] = processor.filter_data(result, threshold=threshold)
        
        # Step 3: Analyze each result
        analytics_results = {}
        for proc_name, filtered_data in filtered_results.items():
            analytics_name = f"analytics_{proc_name}"
            if analytics_name in self.analytics:
                stats = self.analytics[analytics_name].calculate_stats(filtered_data)
                report = self.analytics[analytics_name].generate_report(stats)
                analytics_results[proc_name] = {"stats": stats, "report": report}
        
        # Step 4: Generate final report
        report_gen = ReportGenerator("html")
        final_report = report_gen.create_detailed_report(
            combine_results(list(filtered_results.values())), 
            {"total_processed": sum(len(r) for r in results.values())}
        )
        
        return {
            "processed": results,
            "filtered": filtered_results,
            "analytics": analytics_results,
            "final_report": final_report
        }


# Module-level functions
def create_sample_data(size: int = 100) -> List[int]:
    """Create sample data for processing."""
    return list(range(1, size + 1))


def combine_results(results: List[List[int]]) -> List[int]:
    """Combine multiple result lists."""
    combined = []
    for result in results:
        combined.extend(result)
    return combined


"""Main demo function."""
print("Starting Flow Insight Visualization Demo...")

# Register the current module for instrumentation
import sys
current_module = sys.modules[__name__]
register_module(current_module)

# Create service instances
processor = DataProcessor("main_processor")
analytics = AnalyticsEngine("stats_engine")

# Simulate data processing workflow
print("1. Creating sample data...")
data = create_sample_data(50)

print("2. Processing data...")
processed = processor.process_data(data, multiplier=3)
filtered = processor.filter_data(processed, threshold=50)

print("3. Calculating analytics...")
stats = analytics.calculate_stats(filtered)
report = analytics.generate_report(stats)

print("4. Testing nested services...")
# Test nested services
report_gen = ReportGenerator("html")
detailed_report = report_gen.create_detailed_report(filtered, stats)

print("5. Running complex workflow...")
# Set up complex workflow
orchestrator = WorkflowOrchestrator()
orchestrator.register_processor("processor1", DataProcessor("proc1"))
orchestrator.register_processor("processor2", DataProcessor("proc2"))
orchestrator.register_analytics("analytics_processor1", AnalyticsEngine("analytics1"))
orchestrator.register_analytics("analytics_processor2", AnalyticsEngine("analytics2"))

workflow_config = {
    "multipliers": {"processor1": 2, "processor2": 4},
    "thresholds": {"processor1": 20, "processor2": 60}
}

workflow_result = orchestrator.run_complex_workflow(data, workflow_config)

print(f"6. Results: {report}")
print(f"7. Workflow completed with {len(workflow_result['processed'])} processors")

# Combine results
all_results = combine_results([processed, filtered])
