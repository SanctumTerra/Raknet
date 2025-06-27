# Framer Optimization Notes

## Performance Issues Identified

1. **Memory Management**
   - Frequent array allocations in constructor
   - Large number of Map/Set operations
   - Excessive array copying in batch processing

2. **Data Structures**
   - Using Maps for ordered queues
   - Array.from() creating unnecessary copies
   - Multiple array fills in constructor

3. **Processing Overhead**
   - Multiple iterations over sequences in ACK/NACK processing
   - Inefficient batch processing
   - Redundant timestamp checks

## Optimization Strategies

1. **Memory Optimizations**
   - Pre-allocate buffers where possible
   - Reuse arrays instead of creating new ones
   - Use typed arrays for better memory efficiency

2. **Data Structure Improvements**
   - Replace Maps with more efficient structures where possible
   - Optimize queue implementations
   - Use Set for faster lookups

3. **Processing Improvements**
   - Batch process frames more efficiently
   - Optimize ACK/NACK handling
   - Reduce timestamp comparisons

## Implementation Notes

Changes will be tracked here as they are implemented... 