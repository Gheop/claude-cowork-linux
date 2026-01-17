#!/bin/bash
# Full debugging launcher for claude-cowork with multi-window monitoring
# Opens 4 terminal windows to monitor different log streams in real-time

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/.local/share/claude-cowork/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Claude Cowork Debug Launcher${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Clear old logs
echo -e "${YELLOW}Clearing old logs...${NC}"
rm -f "$LOG_DIR/claude-cowork.log"
rm -f "$LOG_DIR/claude-swift-trace.log"
: > "$LOG_DIR/claude-cowork.log"
: > "$LOG_DIR/claude-swift-trace.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Check if we're using a terminal multiplexer or need to spawn windows
if command -v tmux &> /dev/null; then
    USE_TMUX=1
elif command -v kitty &> /dev/null || command -v gnome-terminal &> /dev/null || command -v konsole &> /dev/null || command -v xterm &> /dev/null; then
    USE_TMUX=0
else
    echo -e "${RED}Error: No suitable terminal found (tmux, kitty, gnome-terminal, konsole, or xterm)${NC}"
    exit 1
fi

if [ "$USE_TMUX" = "1" ]; then
    echo -e "${GREEN}Using tmux for multi-window layout...${NC}"

    # Create new tmux session
    SESSION_NAME="claude-debug-$$"

    # Start tmux session with first pane
    tmux new-session -d -s "$SESSION_NAME" -n "debug"

    # Split into 4 panes (2x2 grid)
    tmux split-window -h -t "$SESSION_NAME"
    tmux split-window -v -t "$SESSION_NAME:0.0"
    tmux split-window -v -t "$SESSION_NAME:0.2"

    # Set pane titles and commands
    # Pane 0 (top-left): Main application output
    tmux send-keys -t "$SESSION_NAME:0.0" "cd '$SCRIPT_DIR' && echo -e '${BLUE}[Window 1: Main Application Output]${NC}' && export ELECTRON_ENABLE_LOGGING=1 && export CLAUDE_COWORK_TRACE_IO=1 && export CLAUDE_COWORK_DEBUG=1 && ./run.sh 2>&1 | tee /tmp/claude-full.log" C-m

    # Pane 1 (top-right): Swift stub trace log
    tmux send-keys -t "$SESSION_NAME:0.1" "echo -e '${GREEN}[Window 2: Swift Stub Trace Log]${NC}' && tail -f '$LOG_DIR/claude-swift-trace.log'" C-m

    # Pane 2 (bottom-left): Main application log
    tmux send-keys -t "$SESSION_NAME:0.2" "echo -e '${YELLOW}[Window 3: Main Application Log]${NC}' && tail -f '$LOG_DIR/claude-cowork.log'" C-m

    # Pane 3 (bottom-right): Process monitor
    tmux send-keys -t "$SESSION_NAME:0.3" "echo -e '${RED}[Window 4: Process Monitor]${NC}' && watch -n 1 'ps aux | grep -E \"(electron|claude)\" | grep -v grep'" C-m

    # Attach to session
    echo -e "${GREEN}Starting debug session...${NC}"
    echo -e "${BLUE}Press Ctrl+B then D to detach${NC}"
    echo -e "${BLUE}Run 'tmux attach -t $SESSION_NAME' to reattach${NC}"
    sleep 2
    tmux attach -t "$SESSION_NAME"

else
    echo -e "${GREEN}Using separate terminal windows...${NC}"

    # Detect terminal emulator
    if command -v kitty &> /dev/null; then
        TERM_CMD="kitty"
        USE_KITTY=1
    elif command -v gnome-terminal &> /dev/null; then
        TERM_CMD="gnome-terminal"
        TERM_ARGS="--window --title"
    elif command -v konsole &> /dev/null; then
        TERM_CMD="konsole"
        TERM_ARGS="--new-tab --title"
    elif command -v xterm &> /dev/null; then
        TERM_CMD="xterm"
        TERM_ARGS="-T"
    else
        echo -e "${RED}Error: No suitable terminal emulator found${NC}"
        exit 1
    fi

    if [ "$USE_KITTY" = "1" ]; then
        # Use kitty's native layout system
        echo -e "${GREEN}Using kitty with split layout...${NC}"

        kitty @ launch --type=os-window --title "Claude Cowork Debug" --cwd "$SCRIPT_DIR"
        WINDOW_ID=$(kitty @ ls | grep -o '"id": [0-9]*' | head -1 | awk '{print $2}')

        # Create 2x2 grid layout
        kitty @ launch --type=tab --tab-title "Debug" --cwd "$SCRIPT_DIR"
        kitty @ launch --type=window --title "Main Application" --cwd "$SCRIPT_DIR" bash -c "echo -e '${BLUE}[Main Application Output]${NC}'; export ELECTRON_ENABLE_LOGGING=1 CLAUDE_COWORK_TRACE_IO=1 CLAUDE_COWORK_DEBUG=1; ./run.sh 2>&1 | tee /tmp/claude-full.log"

        kitty @ launch --type=window --title "Swift Trace" bash -c "echo -e '${GREEN}[Swift Stub Trace Log]${NC}'; echo 'Watching: $LOG_DIR/claude-swift-trace.log'; echo ''; tail -f '$LOG_DIR/claude-swift-trace.log'"

        kitty @ launch --type=window --title "App Log" bash -c "echo -e '${YELLOW}[Main Application Log]${NC}'; echo 'Watching: $LOG_DIR/claude-cowork.log'; echo ''; tail -f '$LOG_DIR/claude-cowork.log'"

        kitty @ launch --type=window --title "Process Monitor" bash -c "echo -e '${RED}[Process Monitor]${NC}'; echo 'Monitoring electron and claude processes'; echo ''; watch -n 1 'ps aux | grep -E \"(electron|claude)\" | grep -v grep'"

        # Set grid layout
        kitty @ goto-layout --match "title:Debug" grid

        echo -e "${GREEN}Kitty windows launched. Check the new kitty window.${NC}"
        exit 0
    else
        # Window 1: Swift stub trace log
        $TERM_CMD $TERM_ARGS "Claude Debug: Swift Stub Trace" -e bash -c "echo -e '${GREEN}[Swift Stub Trace Log]${NC}'; echo 'Watching: $LOG_DIR/claude-swift-trace.log'; echo ''; tail -f '$LOG_DIR/claude-swift-trace.log'" &

        # Window 2: Main application log
        $TERM_CMD $TERM_ARGS "Claude Debug: Main App Log" -e bash -c "echo -e '${YELLOW}[Main Application Log]${NC}'; echo 'Watching: $LOG_DIR/claude-cowork.log'; echo ''; tail -f '$LOG_DIR/claude-cowork.log'" &

        # Window 3: Process monitor
        $TERM_CMD $TERM_ARGS "Claude Debug: Process Monitor" -e bash -c "echo -e '${RED}[Process Monitor]${NC}'; echo 'Monitoring electron and claude processes'; echo ''; watch -n 1 'ps aux | grep -E \"(electron|claude)\" | grep -v grep'" &
    fi

    # Wait for windows to spawn
    sleep 2

    # Window 4: Main application (run in current terminal)
    echo -e "${BLUE}[Main Application Output]${NC}"
    echo -e "${YELLOW}Note: Other debug windows have been opened${NC}"
    echo -e "${BLUE}Starting claude-cowork...${NC}"
    echo ""

    export ELECTRON_ENABLE_LOGGING=1
    export CLAUDE_COWORK_TRACE_IO=1
    export CLAUDE_COWORK_DEBUG=1

    cd "$SCRIPT_DIR"
    ./run.sh 2>&1 | tee /tmp/claude-full.log
fi
