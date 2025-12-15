// Chat Application - Professional Implementation
// Enhanced with robust error handling, state management, and data validation

const statusIndicator = document.querySelector('.status-indicator');
const messagesObj = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const sendBtn = document.getElementById('sendBtn');
const usernameInput = document.getElementById('usernameInput');
const usernameScreen = document.getElementById('usernameScreen');
const chatScreen = document.getElementById('chatScreen');
const partnerNameEl = document.getElementById('partnerName');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const typingIndicator = document.getElementById('typingIndicator');

// State Management
const AppState = {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    SEARCHING: 'searching',
    CHATTING: 'chattng',
    ERROR: 'error'
};

class ChatApplication {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.myName = '';
        this.partnerName = '';
        this.iceFailTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.state = AppState.DISCONNECTED;
        this.messages = [];
        this.scrollManager = null;
        this.connectionTimeout = null;
        this.messageQueue = [];
        this.isReconnecting = false;
        this.init();
    }

    init() {
        if (!this.checkEnvironment()) {
            return;
        }
        this.bindEvents();
        this.setupConnectionMonitoring();
        this.loadFromLocalStorage();
        this.initializeManagers();
        this.setupDiagnostics();
    }

    checkEnvironment() {
        // Check for WebSocket support
        if (typeof WebSocket === 'undefined') {
            this.showToast('Your browser does not support WebSocket connections. Please use a modern browser.', 'error', 10000);
            if (startBtn) startBtn.disabled = true;
            if (usernameInput) usernameInput.disabled = true;
            this.updateStatus('Browser not supported', 'error');
            return false;
        }

        // Check for WebRTC support
        if (typeof RTCPeerConnection === 'undefined') {
            console.warn('WebRTC is not fully supported in this environment');
        }

        // Check if running in HTTPS (required for WebRTC in most browsers)
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            console.warn('Not running on HTTPS - WebRTC may not work properly');
        }

        return true;
    }

    setupDiagnostics() {
        window.diagnoseConnection = () => this.diagnoseConnection();
        window.getAppState = () => this.state;
        window.getConnectionStats = () => this.getConnectionStats();
    }

    initializeManagers() {
        // Initialize scroll manager
        if (messagesObj) {
            this.scrollManager = new ScrollManager(messagesObj);
        }
    }

    bindEvents() {
        // Start button with debounce
        if (startBtn) {
            startBtn.addEventListener('click', () => this.handleStart());
        }

        if (usernameInput) {
            usernameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleStart();
            });
        }

        // Next button
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.handleNext());
        }

        // Send message
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (msgInput) {
            msgInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // Input validation
        if (msgInput) {
            msgInput.addEventListener('input', () => this.validateInput());
        }

        if (usernameInput) {
            usernameInput.addEventListener('input', () => this.validateUsername());
        }

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handleBackground();
            } else {
                this.handleForeground();
            }
        });

        // Handle offline/online events
        window.addEventListener('offline', () => this.handleDisconnect('Network offline'));
        window.addEventListener('online', () => {
            if (this.state === AppState.DISCONNECTED || this.state === AppState.ERROR) {
                this.handleReconnect();
            }
        });

        // Handle beforeunload
        window.addEventListener('beforeunload', () => {
            this.cleanupConnection();
        });
    }

    setupConnectionMonitoring() {
        // Periodic connection health check
        setInterval(() => {
            if (this.state === AppState.CHATTING && this.socket) {
                this.checkConnectionHealth();
            }
        }, 30000);
    }

    // ========== STATE MANAGEMENT ==========

    setState(newState, message = '') {
        console.log(`State change: ${this.state} -> ${newState}`, message);
        const oldState = this.state;
        this.state = newState;

        switch (newState) {
            case AppState.CONNECTING:
                this.updateStatus('Connecting...', 'warning');
                break;
            case AppState.CONNECTED:
                this.updateStatus('Connected to server', 'success');
                break;
            case AppState.DISCONNECTED:
                this.updateStatus('Disconnected', 'error');
                if (message) {
                    this.showToast(`Disconnected: ${message}`, 'error');
                }
                break;
            case AppState.SEARCHING:
                this.updateStatus('Searching for partner...', 'info');
                this.showTypingIndicator(false);
                break;
            case AppState.CHATTING:
                this.updateStatus(this.partnerName || 'Chat active', 'success');
                break;
            case AppState.ERROR:
                this.updateStatus(message || 'Error', 'error');
                this.showToast(message || 'An error occurred', 'error');
                break;
        }

        // Update UI elements based on state
        this.updateUIForState(newState, oldState);
    }

    updateUIForState(newState, oldState) {
        // Enable/disable input based on state
        if (msgInput) {
            msgInput.disabled = newState !== AppState.CHATTING;
            msgInput.placeholder = newState === AppState.CHATTING ? 'Type a message...' : 'Connecting...';
        }

        if (sendBtn) {
            sendBtn.disabled = newState !== AppState.CHATTING;
        }

        // Update next button
        if (nextBtn) {
            if (newState === AppState.CHATTING) {
                nextBtn.innerHTML = 'Next <i class="fas fa-arrow-right"></i>';
                nextBtn.title = 'Find another partner';
                nextBtn.disabled = false;
            } else if (newState === AppState.SEARCHING) {
                nextBtn.innerHTML = 'Searching... <i class="fas fa-spinner fa-spin"></i>';
                nextBtn.disabled = true;
            } else {
                nextBtn.innerHTML = 'Next <i class="fas fa-arrow-right"></i>';
                nextBtn.disabled = newState !== AppState.CONNECTED && newState !== AppState.DISCONNECTED;
            }
        }

        // Update start button
        if (startBtn) {
            startBtn.disabled = newState === AppState.CONNECTING || newState === AppState.SEARCHING;
        }
    }

    updateStatus(text, type = 'info') {
        // Update status indicator
        if (statusIndicator) {
            statusIndicator.textContent = text;
            statusIndicator.className = 'status-indicator';

            switch (type) {
                case 'success':
                    statusIndicator.classList.add('connected');
                    break;
                case 'error':
                    statusIndicator.classList.add('disconnected');
                    break;
                case 'warning':
                    statusIndicator.classList.add('connecting');
                    break;
            }
        }

        // Update partner name display in header
        if (partnerNameEl) {
            if (type === 'success' && this.partnerName && this.state === AppState.CHATTING) {
                partnerNameEl.textContent = this.partnerName;
                partnerNameEl.classList.add('connected');
            } else {
                partnerNameEl.textContent = text;
                partnerNameEl.classList.remove('connected');
            }
        }
    }

    // ========== SESSION MANAGEMENT ==========

    async handleStart() {
        try {
            const name = usernameInput.value.trim();

            if (!this.validateUsername(name)) {
                this.showToast('Please enter a valid name (2-20 characters, letters and numbers only)', 'error');
                usernameInput.focus();
                return;
            }

            this.myName = name;
            this.saveToLocalStorage();

            // UI transition with animation
            if (usernameScreen && chatScreen) {
                usernameScreen.style.opacity = '0';
                setTimeout(() => {
                    usernameScreen.style.display = 'none';
                    chatScreen.style.display = 'flex';
                    setTimeout(() => {
                        chatScreen.style.opacity = '1';
                    }, 10);
                }, 300);
            }

            this.setState(AppState.CONNECTING);
            await this.initSocket();

        } catch (error) {
            console.error('Start error:', error);
            this.showToast('Failed to start chat: ' + error.message, 'error');
            this.setState(AppState.ERROR, error.message);
        }
    }

    handleNext() {
        if (this.state === AppState.CHATTING) {
            if (confirm('Are you sure you want to end this chat and find someone new?')) {
                this.performRematch('User requested new partner');
            }
        } else if (this.state === AppState.SEARCHING) {
            this.showToast('Already searching for a partner', 'info');
        } else if (this.state === AppState.CONNECTED || this.state === AppState.DISCONNECTED) {
            this.performRematch('Finding new partner');
        } else {
            this.showToast('Cannot find new partner while connecting or in error state', 'warning');
        }
    }

    // ========== WEBSOCKET MANAGEMENT ==========

    async initSocket() {
        try {
            // Clean up existing connection
            this.cleanupConnection();

            // Check if WebSocket is available
            if (typeof WebSocket === 'undefined') {
                throw new Error('WebSocket is not supported in this browser/environment');
            }

            // Determine WebSocket URL
            let wsUrl = "Cloud backend url ";
            
            // Try to get URL from configuration
            if (window.ANONCHAT_WS_URL) {
                wsUrl = window.ANONCHAT_WS_URL;
            }
            
            console.log('Connecting to WebSocket:', wsUrl);

            // Validate URL
            if (!wsUrl || (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://'))) {
                throw new Error('Invalid WebSocket URL format');
            }

            // Create socket instance with error handling
            let socket;
            try {
                socket = new WebSocket(wsUrl);
                
                // Check if socket was created successfully
                if (!socket || typeof socket !== 'object') {
                    throw new Error('WebSocket constructor returned invalid value');
                }
            } catch (constructorError) {
                console.error('WebSocket constructor error:', constructorError);
                throw new Error(`Failed to create WebSocket: ${constructorError.message}`);
            }

            // Set connection timeout
            this.connectionTimeout = setTimeout(() => {
                if (socket && socket.readyState === WebSocket.CONNECTING) {
                    console.warn('WebSocket connection timeout (10 seconds)');
                    socket.close(3000, 'Connection timeout');
                    this.handleReconnect();
                }
            }, 10000);

            // Setup event listeners using addEventListener for better compatibility
            socket.addEventListener('open', (event) => {
                clearTimeout(this.connectionTimeout);
                console.log('WebSocket connected successfully');
                this.setState(AppState.CONNECTED);
                this.reconnectAttempts = 0;
                this.isReconnecting = false;

                // Join with name
                this.sendSocketMessage({
                    type: "join",
                    name: this.myName,
                    timestamp: Date.now()
                });

                this.setState(AppState.SEARCHING);
            });

            socket.addEventListener('message', async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebSocket message received:', data);
                    await this.handleSocketMessage(data);
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            });

            socket.addEventListener('close', (event) => {
                clearTimeout(this.connectionTimeout);
                console.log('WebSocket closed:', event.code, event.reason);

                // Only handle close if this is still the active socket
                if (this.socket === socket) {
                    this.setState(AppState.DISCONNECTED, `Connection closed: ${event.reason || 'Unknown reason'}`);

                    // Attempt reconnect if not user-initiated and not in error state
                    if (!event.wasClean && 
                        this.state !== AppState.ERROR &&
                        this.reconnectAttempts < this.maxReconnectAttempts) {
                        setTimeout(() => this.handleReconnect(), 1000);
                    }
                }
            });

            socket.addEventListener('error', (event) => {
                clearTimeout(this.connectionTimeout);
                console.error('WebSocket error event:', event);

                // Only handle error if this is still the active socket
                if (this.socket === socket) {
                    this.setState(AppState.ERROR, 'WebSocket connection error');
                    
                    // Try reconnect after delay
                    setTimeout(() => {
                        if (this.state === AppState.ERROR) {
                            this.handleReconnect();
                        }
                    }, 2000);
                }
            });

            // Assign to instance
            this.socket = socket;

        } catch (error) {
            console.error('Socket initialization error:', error);
            this.setState(AppState.ERROR, error.message);
            
            // Show user-friendly error message
            let userMessage = 'Failed to establish connection to server';
            if (error.message.includes('not supported')) {
                userMessage = 'Your browser does not support WebSocket connections';
            } else if (error.message.includes('Invalid WebSocket URL')) {
                userMessage = 'Invalid server configuration';
            }
            
            this.showToast(userMessage, 'error');
            
            // Try reconnect with backoff
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            setTimeout(() => this.handleReconnect(), delay);
            
            throw error;
        }
    }

    async handleSocketMessage(data) {
        switch (data.type) {
            case "matched":
                await this.handleMatched(data);
                break;
            case "signal":
                await this.handleSignal(data.signal);
                break;
            case "partner-left":
                this.handlePartnerLeft(data);
                break;
            case "error":
                this.handleServerError(data);
                break;
            case "ping":
                this.sendSocketMessage({ type: "pong" });
                break;
            case "typing":
                this.handleTypingIndicator(data);
                break;
            default:
                console.warn('Unknown message type:', data.type);
        }
    }

    sendSocketMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('Error sending WebSocket message:', error);
                return false;
            }
        } else {
            console.warn('WebSocket not open, cannot send message');
            // Queue message for when connection is restored
            if (message.type !== 'ping' && message.type !== 'pong') {
                this.messageQueue.push({message, timestamp: Date.now()});
            }
            return false;
        }
    }

    // ========== WEBRTC MANAGEMENT ==========

    async handleMatched(data) {
        try {
            this.partnerName = data.partnerName;
            this.updateStatus(this.partnerName, 'success');
            this.showToast(`Connected with ${this.partnerName}`, 'success');

            this.setState(AppState.CHATTING);
            await this.startWebRTC(data.initiator);

            // Clear any existing messages
            this.clearMessages();

        } catch (error) {
            console.error('Error in match handling:', error);
            this.showToast('Failed to establish chat connection', 'error');
            this.performRematch('WebRTC connection failed');
        }
    }

    async startWebRTC(isInitiator) {
        try {
            // Clean up existing WebRTC connection
            if (this.peerConnection) {
                this.cleanupWebRTC();
            }

            console.log(`Starting WebRTC as ${isInitiator ? 'initiator' : 'receiver'}`);

            // Create peer connection with configuration
            const config = {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" }
                ],
                iceCandidatePoolSize: 10
            };

            this.peerConnection = new RTCPeerConnection(config);

            // Set up event handlers
            this.setupPeerConnectionEvents();

            if (isInitiator) {
                // Create data channel
                this.dataChannel = this.peerConnection.createDataChannel("chat", {
                    ordered: true,
                    maxRetransmits: 3
                });
                this.setupDataChannel();
                await this.createOffer();
            } else {
                // Set up data channel receiver
                this.peerConnection.ondatachannel = (event) => {
                    this.dataChannel = event.channel;
                    this.setupDataChannel();
                };
            }

            // Set ICE connection timeout
            this.iceFailTimer = setTimeout(() => {
                if (this.peerConnection?.iceConnectionState !== 'connected' &&
                    this.peerConnection?.iceConnectionState !== 'completed') {
                    console.warn('ICE connection timeout (15 seconds)');
                    this.performRematch('Connection timeout');
                }
            }, 15000);

        } catch (error) {
            console.error('WebRTC initialization error:', error);
            throw error;
        }
    }

    setupPeerConnectionEvents() {
        if (!this.peerConnection) return;

        // ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSocketMessage({
                    type: "signal",
                    signal: {
                        type: 'candidate',
                        candidate: event.candidate
                    }
                });
            }
        };

        // ICE connection state
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('ICE connection state:', state);

            switch (state) {
                case 'failed':
                case 'disconnected':
                    this.performRematch(`ICE connection ${state}`);
                    break;
                case 'connected':
                case 'completed':
                    clearTimeout(this.iceFailTimer);
                    this.showToast('Peer-to-peer connection established', 'success');
                    break;
            }
        };

        // Connection state
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Peer connection state:', this.peerConnection.connectionState);

            if (this.peerConnection.connectionState === 'failed') {
                this.performRematch('Peer connection failed');
            }
        };

        // Track events (for future video/audio support)
        this.peerConnection.ontrack = (event) => {
            console.log('Track received:', event);
        };
    }

    setupDataChannel() {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
            this.setState(AppState.CHATTING);
            this.sendSocketMessage({ type: "connected" });
            clearTimeout(this.iceFailTimer);
            this.showToast('Chat ready! You can start messaging.', 'success');
            
            // Process any queued messages
            this.processMessageQueue();
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const message = event.data;
                this.addMessage({
                    text: message,
                    sender: this.partnerName,
                    type: 'them',
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('Error processing incoming message:', error);
            }
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
            if (this.state === AppState.CHATTING) {
                this.performRematch('Data channel closed unexpectedly');
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.performRematch('Data channel error');
        };
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });

            await this.peerConnection.setLocalDescription(offer);

            this.sendSocketMessage({
                type: "signal",
                signal: offer
            });

        } catch (error) {
            console.error('Error creating offer:', error);
            throw error;
        }
    }

    async handleSignal(signal) {
        try {
            if (!this.peerConnection) {
                await this.startWebRTC(false);
            }

            if (signal.type === 'offer') {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(signal)
                );

                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);

                this.sendSocketMessage({
                    type: "signal",
                    signal: answer
                });

            } else if (signal.type === 'answer') {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(signal)
                );

            } else if (signal.type === 'candidate' && signal.candidate) {
                try {
                    await this.peerConnection.addIceCandidate(
                        new RTCIceCandidate(signal.candidate)
                    );
                } catch (error) {
                    console.warn('Error adding ICE candidate:', error);
                }
            }
        } catch (error) {
            console.error('Error handling signal:', error);
            this.performRematch('WebRTC signal error');
        }
    }

    // ========== MESSAGE HANDLING ==========

    async sendMessage() {
        try {
            const message = msgInput.value.trim();

            if (!message) {
                this.showToast('Message cannot be empty', 'warning');
                return;
            }

            if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
                this.showToast('Connection not ready. Please wait...', 'error');
                return;
            }

            // Validate message length
            if (message.length > 1000) {
                this.showToast('Message too long (maximum 1000 characters)', 'warning');
                return;
            }

            // Send via WebRTC
            this.dataChannel.send(message);

            // Add to local UI
            this.addMessage({
                text: message,
                sender: 'You',
                type: 'me',
                timestamp: Date.now()
            });

            // Clear input
            msgInput.value = '';
            this.validateInput();

            // Save to history
            this.saveMessageToHistory(message);

        } catch (error) {
            console.error('Error sending message:', error);
            this.showToast('Failed to send message', 'error');
        }
    }

    processMessageQueue() {
        if (this.messageQueue.length === 0) return;
        
        console.log(`Processing ${this.messageQueue.length} queued messages`);
        const now = Date.now();
        const maxAge = 30000; // 30 seconds
        
        this.messageQueue = this.messageQueue.filter(item => {
            if (now - item.timestamp > maxAge) {
                return false; // Message too old
            }
            
            // Try to resend
            if (this.sendSocketMessage(item.message)) {
                return false; // Successfully sent, remove from queue
            }
            
            return true; // Still failed, keep in queue
        });
    }

    addMessage(messageData) {
        try {
            // Remove empty state if present
            const emptyState = messagesObj.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            // Create message element
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${messageData.type}`;

            // Add message content
            const content = document.createElement('div');
            content.textContent = messageData.text;
            messageDiv.appendChild(content);

            // Add timestamp
            const timestamp = document.createElement('div');
            timestamp.className = 'message-timestamp';
            timestamp.textContent = this.formatTime(messageData.timestamp);
            messageDiv.appendChild(timestamp);

            // Add to chat log
            messagesObj.appendChild(messageDiv);

            // Store in memory
            this.messages.push(messageData);

            // Auto-clear if too many messages (performance optimization)
            if (this.messages.length > 500) {
                this.messages = this.messages.slice(-250);
                // Remove old DOM elements
                while (messagesObj.children.length > 250) {
                    messagesObj.removeChild(messagesObj.firstChild);
                }
            }

            // Scroll handling
            if (this.scrollManager) {
                this.scrollManager.handleNewMessage();
            }

        } catch (error) {
            console.error('Error adding message to UI:', error);
        }
    }

    clearMessages() {
        try {
            if (messagesObj) {
                messagesObj.innerHTML = '';
                this.messages = [];

                // Add empty state message
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.innerHTML = `
                    <h3>Start chatting!</h3>
                    <p>Messages with ${this.partnerName || 'your partner'} will appear here</p>
                `;
                messagesObj.appendChild(emptyState);
            }

        } catch (error) {
            console.error('Error clearing messages:', error);
        }
    }

    showTypingIndicator(show) {
        if (typingIndicator) {
            typingIndicator.style.display = show ? 'flex' : 'none';

            if (show && this.scrollManager) {
                this.scrollManager.scrollToBottom();
            }
        }
    }

    handleTypingIndicator(data) {
        if (data.typing && this.state === AppState.CHATTING) {
            this.showTypingIndicator(true);

            // Auto-hide after 3 seconds
            setTimeout(() => {
                this.showTypingIndicator(false);
            }, 3000);
        } else {
            this.showTypingIndicator(false);
        }
    }

    // ========== ERROR HANDLING ==========

    handlePartnerLeft(data) {
        const reason = data.reason || 'Partner disconnected';
        this.showToast(reason, 'info');
        this.performRematch(reason);
    }

    handleServerError(data) {
        console.error('Server error:', data);
        const message = data.message || 'Server error occurred';
        this.showToast(message, 'error');

        if (data.code === 'rate_limit') {
            setTimeout(() => this.performRematch('Rate limit exceeded'), 5000);
        } else if (data.code === 'name_taken') {
            this.showToast('Name is already taken. Please choose another.', 'error');
            if (usernameScreen && chatScreen) {
                chatScreen.style.opacity = '0';
                setTimeout(() => {
                    chatScreen.style.display = 'none';
                    usernameScreen.style.display = 'flex';
                    setTimeout(() => {
                        usernameScreen.style.opacity = '1';
                        if (usernameInput) usernameInput.focus();
                    }, 10);
                }, 300);
            }
        }
    }

    handleDisconnect(reason) {
        console.log('Disconnect:', reason);
        this.showToast(reason, 'error');
        this.setState(AppState.DISCONNECTED);
        this.cleanupConnection();
    }

    async handleReconnect() {
        // Don't reconnect if already reconnecting or at max attempts
        if (this.isReconnecting) {
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showToast('Maximum reconnection attempts reached. Please refresh the page.', 'error');
            
            // Offer manual refresh option after delay
            setTimeout(() => {
                if (this.state !== AppState.CHATTING && this.state !== AppState.CONNECTED) {
                    if (confirm('Unable to reconnect. Would you like to refresh the page?')) {
                        window.location.reload();
                    }
                }
            }, 1000);
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;
        
        const attemptMsg = `Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        this.showToast(attemptMsg, 'info');
        this.setState(AppState.CONNECTING);

        try {
            await this.initSocket();
            this.isReconnecting = false;
        } catch (error) {
            console.error('Reconnection attempt failed:', error);
            this.isReconnecting = false;
            
            // Exponential backoff with jitter
            const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;
            
            console.log(`Next reconnection attempt in ${Math.round(delay/1000)} seconds`);
            
            setTimeout(() => {
                // Only retry if still disconnected or in error state
                if (this.state !== AppState.CHATTING && this.state !== AppState.CONNECTED) {
                    this.handleReconnect();
                }
            }, delay);
        }
    }

    performRematch(reason) {
        console.log('Rematching:', reason);

        // Show reason to user
        if (reason && reason !== 'User requested new partner') {
            this.showToast(reason, 'info');
        }

        // Clean up
        this.cleanupWebRTC();
        this.clearMessages();
        this.partnerName = '';
        this.messageQueue = [];

        // Update UI
        this.updateStatus('Finding new partner...', 'info');
        this.setState(AppState.SEARCHING);

        // Request new match
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.sendSocketMessage({
                type: "join",
                name: this.myName,
                timestamp: Date.now()
            });
        } else {
            this.initSocket();
        }
    }

    checkConnectionHealth() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.handleReconnect();
            return;
        }

        // Send ping to check connection
        this.sendSocketMessage({ type: "ping" });
        
        // Check data channel health
        if (this.dataChannel && this.dataChannel.readyState !== 'open') {
            this.performRematch('Data channel closed');
        }
    }

    // ========== VALIDATION ==========

    validateUsername(name = usernameInput?.value.trim()) {
        if (!name) return false;
        
        const isValid = name.length >= 2 && 
                       name.length <= 20 && 
                       /^[a-zA-Z0-9\s\-_]+$/.test(name);

        // Visual feedback
        if (usernameInput) {
            if (name && !isValid) {
                usernameInput.style.borderColor = 'var(--error-color)';
                usernameInput.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.2)';
            } else {
                usernameInput.style.borderColor = '';
                usernameInput.style.boxShadow = '';
            }
        }

        return isValid;
    }

    validateInput() {
        if (!msgInput) return false;
        
        const message = msgInput.value.trim();
        const isValid = message.length > 0 && message.length <= 1000;

        if (sendBtn) {
            sendBtn.disabled = !isValid || this.state !== AppState.CHATTING;
        }

        // Character counter
        let counter = document.getElementById('char-counter');
        if (!counter && msgInput.parentNode) {
            counter = document.createElement('div');
            counter.id = 'char-counter';
            counter.style.cssText = 'font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;';
            msgInput.parentNode.appendChild(counter);
        }

        if (counter) {
            counter.textContent = `${message.length}/1000`;
            counter.style.color = message.length > 800 ? 'var(--error-color)' : 
                                 message.length > 600 ? 'var(--warning-color)' : 
                                 'var(--text-secondary)';
        }

        return isValid;
    }

    // ========== UTILITIES ==========

    cleanupConnection() {
        this.cleanupWebRTC();

        if (this.socket) {
            // Remove event listeners first
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            this.socket.onopen = null;
            
            // Close if not already closed
            if (this.socket.readyState !== WebSocket.CLOSED && 
                this.socket.readyState !== WebSocket.CLOSING) {
                this.socket.close(1000, 'Cleanup');
            }
            this.socket = null;
        }

        clearTimeout(this.iceFailTimer);
        clearTimeout(this.connectionTimeout);
    }

    cleanupWebRTC() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        clearTimeout(this.iceFailTimer);
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    showToast(message, type = 'info', duration = 3000) {
        // Remove existing toasts
        const existing = document.querySelectorAll('.toast');
        existing.forEach(toast => toast.remove());

        // Create toast
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        // Style
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 8px;
            background: ${type === 'error' ? 'var(--error-color)' :
                type === 'success' ? 'var(--success-color)' :
                type === 'warning' ? 'var(--warning-color)' : 'var(--primary-color)'};
            color: white;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
            max-width: 400px;
            word-break: break-word;
        `;

        document.body.appendChild(toast);

        // Auto-remove
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }

    // ========== DIAGNOSTICS ==========

    diagnoseConnection() {
        const diagnostics = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            webSocketSupported: typeof WebSocket !== 'undefined',
            webRTCSupported: typeof RTCPeerConnection !== 'undefined',
            onlineStatus: navigator.onLine,
            protocol: window.location.protocol,
            currentState: this.state,
            reconnectAttempts: this.reconnectAttempts,
            socketState: this.socket ? this.socket.readyState : 'no socket',
            dataChannelState: this.dataChannel ? this.dataChannel.readyState : 'no data channel',
            peerConnectionState: this.peerConnection ? this.peerConnection.connectionState : 'no peer connection',
            partnerName: this.partnerName,
            myName: this.myName,
            messageCount: this.messages.length,
            queuedMessages: this.messageQueue.length
        };

        console.log('Connection Diagnostics:', diagnostics);
        return diagnostics;
    }

    getConnectionStats() {
        return {
            state: this.state,
            partner: this.partnerName,
            messagesSent: this.messages.filter(m => m.type === 'me').length,
            messagesReceived: this.messages.filter(m => m.type === 'them').length,
            uptime: this.getUptime(),
            connectionQuality: this.assessConnectionQuality()
        };
    }

    getUptime() {
        // Implementation would track when connection started
        return 'Not implemented';
    }

    assessConnectionQuality() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            return 'poor';
        }
        
        if (this.peerConnection && 
            (this.peerConnection.iceConnectionState === 'connected' || 
             this.peerConnection.iceConnectionState === 'completed')) {
            return 'good';
        }
        
        return 'fair';
    }

    // ========== PERSISTENCE ==========

    saveToLocalStorage() {
        try {
            localStorage.setItem('anonChat_username', this.myName);
            localStorage.setItem('anonChat_lastSession', Date.now().toString());
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }
    }

    loadFromLocalStorage() {
        try {
            const savedName = localStorage.getItem('anonChat_username');
            if (savedName && usernameInput) {
                usernameInput.value = savedName;
                this.validateUsername();
            }
        } catch (error) {
            console.warn('Failed to load from localStorage:', error);
        }
    }

    saveMessageToHistory(message) {
        try {
            const history = JSON.parse(localStorage.getItem('anonChat_history') || '[]');
            history.push({
                message,
                timestamp: Date.now(),
                partner: this.partnerName || 'Unknown'
            });

            // Keep only last 100 messages
            if (history.length > 100) {
                history.splice(0, history.length - 100);
            }

            localStorage.setItem('anonChat_history', JSON.stringify(history));
        } catch (error) {
            console.warn('Failed to save message history:', error);
        }
    }

    // ========== BACKGROUND HANDLING ==========

    handleBackground() {
        console.log('App went to background');
        // Reduce connection activity
        if (this.iceFailTimer) {
            clearTimeout(this.iceFailTimer);
        }
        
        // Send pause signal if chatting
        if (this.state === AppState.CHATTING && this.socket) {
            this.sendSocketMessage({ type: "pause" });
        }
    }

    handleForeground() {
        console.log('App came to foreground');
        // Check connection status
        if (this.state === AppState.CHATTING && this.socket) {
            this.sendSocketMessage({ type: "resume" });
            this.checkConnectionHealth();
        } else if (this.state === AppState.DISCONNECTED || this.state === AppState.ERROR) {
            this.handleReconnect();
        }
    }
}

// ===============================
// Scroll Behavior Management
// ===============================
class ScrollManager {
    constructor(chatLogElement) {
        this.chatLog = chatLogElement;
        this.isAtBottom = true;
        this.scrollThreshold = 80;
        this.scrollToBottomBtn = document.getElementById('scrollToBottom');
        this.init();
    }

    init() {
        if (!this.chatLog) return;
        
        this.chatLog.addEventListener('scroll', () => this.handleScroll());
        this.scrollToBottom(false);

        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.addEventListener('click', () => {
                this.scrollToBottom(true);
            });
        }
    }

    handleScroll() {
        if (!this.chatLog) return;
        
        const { scrollTop, scrollHeight, clientHeight } = this.chatLog;

        // WhatsApp-like bottom detection
        this.isAtBottom =
            scrollHeight - (scrollTop + clientHeight) <= this.scrollThreshold;

        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.style.display =
                this.isAtBottom ? 'none' : 'flex';
        }
    }

    scrollToBottom(smooth = true) {
        if (!this.chatLog) return;
        
        this.chatLog.scrollTo({
            top: this.chatLog.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
        });

        this.isAtBottom = true;
        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.style.display = 'none';
        }
    }

    handleNewMessage() {
        // Auto-scroll ONLY if user is already at bottom
        if (this.isAtBottom) {
            requestAnimationFrame(() => this.scrollToBottom(true));
        }
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.chatApp = new ChatApplication();
        console.log('Chat application initialized successfully');
    } catch (error) {
        console.error('Failed to initialize chat application:', error);
        
        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #dc2626;
            color: white;
            padding: 1rem;
            text-align: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;
        errorDiv.textContent = 'Failed to initialize chat application. Please refresh the page.';
        document.body.appendChild(errorDiv);
        
        // Add refresh button
        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Refresh Page';
        refreshBtn.style.cssText = `
            margin-left: 1rem;
            padding: 0.5rem 1rem;
            background: white;
            color: #dc2626;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        `;
        refreshBtn.onclick = () => window.location.reload();
        errorDiv.appendChild(refreshBtn);
    }
});

// Add CSS animations for toast
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Export for debugging and external access
window.ChatApp = window.chatApp;