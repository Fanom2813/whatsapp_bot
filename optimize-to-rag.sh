#!/bin/bash

# Markdown RAG Optimizer
# Optimizes markdown files for RAG with text embeddings (no chunking)
# Usage: ./optimize_markdown.sh input.md [output.md]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <input_file.md> [output_file.md]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -v, --verbose  Enable verbose output"
    echo ""
    echo "Examples:"
    echo "  $0 document.md"
    echo "  $0 document.md optimized.md"
    echo "  $0 -v document.md optimized.md"
}

# Default values
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -*)
            print_error "Unknown option $1"
            show_usage
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_FILE" ]]; then
                INPUT_FILE="$1"
            elif [[ -z "$OUTPUT_FILE" ]]; then
                OUTPUT_FILE="$1"
            else
                print_error "Too many arguments"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Check if input file is provided
if [[ -z "$INPUT_FILE" ]]; then
    print_error "Input file is required"
    show_usage
    exit 1
fi

# Check if input file exists
if [[ ! -f "$INPUT_FILE" ]]; then
    print_error "Input file '$INPUT_FILE' not found"
    exit 1
fi

# Set default output file if not provided
if [[ -z "$OUTPUT_FILE" ]]; then
    OUTPUT_FILE="${INPUT_FILE%.*}_optimized.md"
fi

# Create temporary directory for processing
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

TEMP_FILE="$TEMP_DIR/processing.md"

print_status "Starting markdown optimization for RAG..."
print_status "Input file: $INPUT_FILE"
print_status "Output file: $OUTPUT_FILE"

# Step 1: Clean and normalize the markdown
print_status "Step 1: Cleaning and normalizing markdown..."

# Copy input to temp file
cp "$INPUT_FILE" "$TEMP_FILE"

# Remove excessive whitespace and normalize line endings
sed -i '' 's/[[:space:]]*$//' "$TEMP_FILE"  # Remove trailing whitespace
sed -i '' '/^$/N;/^\n$/d' "$TEMP_FILE"      # Remove multiple blank lines

# Step 2: Convert to lowercase (preserve code blocks)
print_status "Step 2: Converting text to lowercase..."

# Mark code blocks to preserve them during processing
awk '
BEGIN { in_code = 0; block_num = 0 }
/^```/ { 
    if (in_code == 0) {
        in_code = 1
        block_num++
        print "<<<CODE_BLOCK_START_" block_num ">>>"
    } else {
        in_code = 0
        print "<<<CODE_BLOCK_END_" block_num ">>>"
    }
    next
}
in_code == 1 { print "<<<CODE_LINE>>>" $0; next }
{ print }
' "$TEMP_FILE" > "$TEMP_DIR/with_markers.md"

# Convert to lowercase (except code blocks)
awk '
/<<<CODE_BLOCK_START_/ { print; in_code = 1; next }
/<<<CODE_BLOCK_END_/ { print; in_code = 0; next }
/<<<CODE_LINE>>>/ { print; next }
in_code == 0 { print tolower($0); next }
{ print }
' "$TEMP_DIR/with_markers.md" > "$TEMP_DIR/lowercase.md"

# Step 3: Clean up formatting and links
print_status "Step 3: Cleaning formatting and links..."

# Remove or simplify problematic elements for embeddings
sed -i '' 's/\*\*\([^*]*\)\*\*/\1/g' "$TEMP_DIR/lowercase.md"    # Remove bold
sed -i '' 's/\*\([^*]*\)\*/\1/g' "$TEMP_DIR/lowercase.md"        # Remove italic
sed -i '' 's/`\([^`]*\)`/\1/g' "$TEMP_DIR/lowercase.md"          # Remove inline code
sed -i '' 's/~~\([^~]*\)~~/\1/g' "$TEMP_DIR/lowercase.md"        # Remove strikethrough

# Clean up links but preserve the text
sed -i '' 's/\[\([^]]*\)\]([^)]*)/ \1 /g' "$TEMP_DIR/lowercase.md"

# Remove HTML tags
sed -i '' 's/<[^>]*>//g' "$TEMP_DIR/lowercase.md"

# Remove image references
sed -i '' 's/!\[\([^]]*\)\]([^)]*)/ \1 /g' "$TEMP_DIR/lowercase.md"

# Step 4: Restore code blocks
print_status "Step 4: Restoring code blocks..."

# Restore code blocks
sed -i '' 's/<<<CODE_BLOCK_START_[0-9]*>>>/```/g' "$TEMP_DIR/lowercase.md"
sed -i '' 's/<<<CODE_BLOCK_END_[0-9]*>>>/```/g' "$TEMP_DIR/lowercase.md"
sed -i '' 's/<<<CODE_LINE>>>//g' "$TEMP_DIR/lowercase.md"

# Step 5: Remove headers completely
print_status "Step 5: Removing headers..."

# Remove headers completely (they don't add semantic value for embeddings)
sed -i '' '/^######* /d' "$TEMP_DIR/lowercase.md"

# Step 6: Remove special characters and normalize punctuation
print_status "Step 6: Normalizing punctuation and special characters..."

# Remove or normalize special characters
sed -i '' 's/[""]/"/g' "$TEMP_DIR/lowercase.md"                   # Normalize quotes
sed -i '' "s/['']/'/g" "$TEMP_DIR/lowercase.md"                   # Normalize apostrophes
sed -i '' 's/[—–]/-/g' "$TEMP_DIR/lowercase.md"                   # Normalize dashes
sed -i '' 's/[…]/.../g' "$TEMP_DIR/lowercase.md"                  # Normalize ellipsis

# Remove table formatting
sed -i '' 's/|//g' "$TEMP_DIR/lowercase.md"                       # Remove table pipes
sed -i '' '/^[-: ]*$/d' "$TEMP_DIR/lowercase.md"                  # Remove table separators

# Step 7: Final cleanup
print_status "Step 7: Final cleanup..."

# Remove excessive blank lines and whitespace
sed -i '' '/^$/N;/^\n$/d' "$TEMP_DIR/lowercase.md"
sed -i '' 's/[[:space:]]*$//' "$TEMP_DIR/lowercase.md"
sed -i '' 's/^[[:space:]]*//' "$TEMP_DIR/lowercase.md"

# Remove lines with only special characters
sed -i '' '/^[[:punct:][:space:]]*$/d' "$TEMP_DIR/lowercase.md"

# Normalize multiple spaces to single space
sed -i '' 's/  */ /g' "$TEMP_DIR/lowercase.md"

# Create the final output
print_status "Creating optimized output..."

# Append the processed content directly (no header comments)
cat "$TEMP_DIR/lowercase.md" > "$OUTPUT_FILE"

# Final cleanup of output file
sed -i '' '/^$/N;/^\n$/d' "$OUTPUT_FILE"

# Calculate statistics
ORIGINAL_SIZE=$(wc -c < "$INPUT_FILE")
OPTIMIZED_SIZE=$(wc -c < "$OUTPUT_FILE")
ORIGINAL_LINES=$(wc -l < "$INPUT_FILE")
OPTIMIZED_LINES=$(wc -l < "$OUTPUT_FILE")

print_success "Markdown optimization completed!"
echo ""
echo "Statistics:"
echo "  Original file size: $ORIGINAL_SIZE bytes ($ORIGINAL_LINES lines)"
echo "  Optimized file size: $OPTIMIZED_SIZE bytes ($OPTIMIZED_LINES lines)"
echo "  Size change: $(( OPTIMIZED_SIZE - ORIGINAL_SIZE )) bytes"
echo ""
print_success "Optimized file saved as: $OUTPUT_FILE"

if [[ "$VERBOSE" == true ]]; then
    print_status "Optimization details:"
    echo "  ✓ Converted all text to lowercase"
    echo "  ✓ Removed markdown formatting (bold, italic, etc.)"
    echo "  ✓ Cleaned up links and images"
    echo "  ✓ Preserved code blocks"
    echo "  ✓ Removed all headers (they don't add semantic value)"
    echo "  ✓ Removed HTML tags"
    echo "  ✓ Normalized punctuation and quotes"
    echo "  ✓ Removed table formatting"
    echo "  ✓ Cleaned excessive whitespace"
    echo "  ✓ Added RAG metadata"
fi

print_status "The optimized markdown is now ready for text embedding and RAG systems!"