#!/bin/bash

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "Starting tests..."

# Initialize counters and arrays
passed=0
failed=0
total_passed=0
total_failed=0
failed_tests=()
failed_errors=()

# Dynamically find all test files in the entire test directory
echo "Finding test files in test directory..."
test_files=($(find test -name "*.test.ts" -type f | sort))

if [ ${#test_files[@]} -eq 0 ]; then
  echo "No test files found in test directory!"
  exit 1
fi

echo "Found ${#test_files[@]} test files:"
for file in "${test_files[@]}"; do
  echo "   - $file"
done
echo ""

# Run each test file
for file in "${test_files[@]}"; do
  echo ""
  echo "Running $file..."
  
  # Run the test and capture output and exit code
  output=$(hardhat test "$file" --network hardhat 2>&1 | grep -v -E "(Hardhat deployments config reset|Granting minter role|Parameter.*isn't the same as define in config|\[ParametersStorage\] Setting parameter)")
  exit_code=$?
  
  # Also capture full output for error reporting (without filtering)
  full_output=$(hardhat test "$file" --network hardhat 2>&1 | grep -v -E "(Hardhat deployments config reset|Granting minter role|Parameter.*isn't the same as define in config|\[ParametersStorage\] Setting parameter)")
  
  # Extract test counts from output
  passing_count=$(echo "$output" | grep -o '[0-9]\+ passing' | head -1 | grep -o '[0-9]\+' || echo "0")
  failing_count=$(echo "$output" | grep -o '[0-9]\+ failing' | head -1 | grep -o '[0-9]\+' || echo "0")
  
  # Check if test file passed or failed
  if [ $exit_code -eq 0 ] && [ $failing_count -eq 0 ]; then
    echo -e "${GREEN}PASSED: $file ($passing_count passing, $failing_count failing)${NC}"
    ((passed++))
  else
    echo -e "${RED}FAILED: $file ($passing_count passing, $failing_count failing)${NC}"
    failed_tests+=("$file")
    failed_errors+=("$full_output")
    ((failed++))
  fi
  
  # Add to totals
  total_passed=$((total_passed + passing_count))
  total_failed=$((total_failed + failing_count))
done

# Display final summary
echo ""
echo -e "${BLUE}FINAL SUMMARY${NC}"
echo "============="
echo -e "Total tests passed: ${GREEN}$total_passed${NC}"
echo -e "Total tests failed: ${RED}$total_failed${NC}"
echo "Total individual tests: $((total_passed + total_failed))"

# Show failed tests and their errors if any
if [ ${#failed_tests[@]} -gt 0 ] || [ $total_failed -gt 0 ]; then
  echo ""
  echo -e "${RED}FAILED TESTS AND ERRORS:${NC}"
  echo "========================"
  for i in "${!failed_tests[@]}"; do
    echo ""
    echo -e "${RED}FAILED: ${failed_tests[$i]}:${NC}"
    echo "----------------------------------------"
    echo "${failed_errors[$i]}"
    echo "----------------------------------------"
  done
fi

# Exit with error code if any tests failed
if [ $failed -gt 0 ] || [ $total_failed -gt 0 ]; then
  echo ""
  echo -e "${RED}Some tests failed! Check the errors above.${NC}"
  exit 1
else
  echo ""
  echo -e "${GREEN}All tests passed successfully!${NC}"
fi 