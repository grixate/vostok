package chat.vostok.android.navigation

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Contacts
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import chat.vostok.android.R
import chat.vostok.android.app.AppContainer
import chat.vostok.android.app.AppState
import chat.vostok.android.designsystem.components.VostokButton
import chat.vostok.android.features.auth.AuthViewModel
import chat.vostok.android.features.auth.LoginScreen
import chat.vostok.android.features.auth.RegistrationScreen
import chat.vostok.android.features.calls.CallScreen
import chat.vostok.android.features.calls.CallViewModel
import chat.vostok.android.features.calls.GroupCallScreen
import chat.vostok.android.features.calls.IncomingCallScreen
import chat.vostok.android.features.chatlist.ChatListScreen
import chat.vostok.android.features.chatlist.ChatListViewModel
import chat.vostok.android.features.contacts.ContactListScreen
import chat.vostok.android.features.contacts.ContactListViewModel
import chat.vostok.android.features.conversation.ConversationScreen
import chat.vostok.android.features.conversation.ConversationViewModel
import chat.vostok.android.features.groups.CreateGroupScreen
import chat.vostok.android.features.groups.GroupInfoScreen
import chat.vostok.android.features.groups.GroupViewModel
import chat.vostok.android.features.media.ImageViewer
import chat.vostok.android.features.media.MediaGallery
import chat.vostok.android.features.media.MediaViewModel
import chat.vostok.android.features.profile.ProfileScreen
import chat.vostok.android.features.profile.SafetyNumberScreen
import chat.vostok.android.features.settings.DevicesScreen
import chat.vostok.android.features.settings.PrivacySettingsScreen
import chat.vostok.android.features.settings.SettingsScreen
import chat.vostok.android.features.settings.SettingsViewModel

private data class TabDestination(val route: String, val titleRes: Int)

private fun conversationRoute(chatId: String, title: String? = null): String {
    val encodedChatId = Uri.encode(chatId)
    val encodedTitle = title?.takeIf { it.isNotBlank() }?.let(Uri::encode)
    return if (encodedTitle != null) {
        "conversation/$encodedChatId?title=$encodedTitle"
    } else {
        "conversation/$encodedChatId"
    }
}

@Composable
fun VostokNavGraph(
    appState: AppState,
    container: AppContainer
) {
    val navController = rememberNavController()
    val session by appState.session.collectAsState()
    val pendingOpenChatId by appState.pendingOpenChatId.collectAsState()
    val socketConnectionState by container.webSocketManager.connectionState.collectAsState()
    val socketDiagnostics by container.webSocketManager.diagnostics.collectAsState()
    val socketLog by container.webSocketManager.diagnosticLog.collectAsState()

    val tabs = listOf(
        TabDestination("chats", R.string.tab_chats),
        TabDestination("contacts", R.string.tab_contacts),
        TabDestination("settings", R.string.tab_settings)
    )

    val authViewModel: AuthViewModel = viewModel(
        factory = AuthViewModel.Factory(
            authRepository = container.authRepository,
            appState = appState
        )
    )

    val chatListViewModel: ChatListViewModel = viewModel(
        factory = ChatListViewModel.Factory(
            chatRepository = container.chatRepository,
            webSocketManager = container.webSocketManager
        )
    )

    val conversationViewModel: ConversationViewModel = viewModel(
        factory = ConversationViewModel.Factory(
            messageRepository = container.messageRepository,
            mediaRepository = container.mediaRepository,
            webSocketManager = container.webSocketManager
        )
    )

    val contactListViewModel: ContactListViewModel = viewModel(
        factory = ContactListViewModel.Factory(contactRepository = container.contactRepository)
    )

    val settingsViewModel: SettingsViewModel = viewModel(
        factory = SettingsViewModel.Factory(deviceRepository = container.deviceRepository)
    )

    val groupViewModel: GroupViewModel = viewModel(
        factory = GroupViewModel.Factory(groupRepository = container.groupRepository)
    )

    val callViewModel: CallViewModel = viewModel(
        factory = CallViewModel.Factory(
            callRepository = container.callRepository,
            webSocketManager = container.webSocketManager
        )
    )

    val mediaViewModel: MediaViewModel = viewModel(
        factory = MediaViewModel.Factory(
            mediaRepository = container.mediaRepository,
            messageRepository = container.messageRepository
        )
    )

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val connectivityManager = rememberConnectivityManager(context)

    val startDestination = if (session.isAuthenticated) "chats" else "auth/register"

    LaunchedEffect(session.token, session.userId) {
        val token = session.token
        if (!token.isNullOrBlank()) {
            container.webSocketManager.connect(token)
            container.webSocketManager.resume()
            session.userId?.takeIf { it.isNotBlank() }?.let { userId ->
                container.webSocketManager.join("user:$userId")
            }
        } else {
            container.webSocketManager.disconnect()
        }
    }

    DisposableEffect(connectivityManager) {
        container.webSocketManager.updateNetworkAvailability(
            isNetworkAvailable(connectivityManager)
        )

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                container.webSocketManager.updateNetworkAvailability(
                    isNetworkAvailable(connectivityManager)
                )
            }

            override fun onLost(network: Network) {
                container.webSocketManager.updateNetworkAvailability(
                    isNetworkAvailable(connectivityManager)
                )
            }

            override fun onUnavailable() {
                container.webSocketManager.updateNetworkAvailability(false)
            }
        }

        connectivityManager.registerDefaultNetworkCallback(callback)

        onDispose {
            runCatching { connectivityManager.unregisterNetworkCallback(callback) }
        }
    }

    DisposableEffect(lifecycleOwner, session.token) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    if (session.isAuthenticated) {
                        container.webSocketManager.resume()
                    }
                }

                Lifecycle.Event.ON_STOP -> {
                    container.webSocketManager.pause()
                }

                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(session.isAuthenticated, pendingOpenChatId) {
        val chatId = pendingOpenChatId
        if (session.isAuthenticated && !chatId.isNullOrBlank()) {
            navController.navigate("conversation/${Uri.encode(chatId)}")
            appState.consumeOpenChatRequest()
        }
    }

    Scaffold(
        bottomBar = {
            if (session.isAuthenticated) {
                val currentEntry by navController.currentBackStackEntryAsState()
                val currentRoute = currentEntry?.destination?.route
                NavigationBar {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    restoreState = true
                                    launchSingleTop = true
                                }
                            },
                            icon = {
                                when (tab.route) {
                                    "chats" -> Icon(Icons.AutoMirrored.Outlined.Chat, contentDescription = null)
                                    "contacts" -> Icon(Icons.Outlined.Contacts, contentDescription = null)
                                    else -> Icon(Icons.Outlined.Settings, contentDescription = null)
                                }
                            },
                            label = { Text(stringResource(id = tab.titleRes)) }
                        )
                    }
                }
            }
        }
    ) { padding ->
        key(session.isAuthenticated) {
            NavHost(navController = navController, startDestination = startDestination) {
                composable("auth/register") {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        RegistrationScreen(authViewModel)
                        VostokButton(text = "I already have a device") {
                            navController.navigate("auth/login")
                        }
                    }
                }

                composable("auth/login") {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        LoginScreen(authViewModel)
                        VostokButton(text = "Create new account") {
                            navController.navigate("auth/register")
                        }
                    }
                }

                composable("chats") {
                    ChatListScreen(
                        paddingValues = padding,
                        viewModel = chatListViewModel,
                        onOpenConversation = { chatId, title ->
                            navController.navigate(conversationRoute(chatId, title))
                        }
                    )
                }

                composable("conversation/{chatId}?title={title}") { backStackEntry ->
                    val chatId = backStackEntry.arguments?.getString("chatId").orEmpty()
                    val title = backStackEntry.arguments?.getString("title")
                    LaunchedEffect(chatId) {
                        container.webSocketManager.join("chat:$chatId")
                        container.webSocketManager.join("call:$chatId")
                    }

                    ConversationScreen(
                        chatId = chatId,
                        chatTitle = title,
                        recipientDeviceIds = emptyList(),
                        viewModel = conversationViewModel,
                        onOpenCall = { selectedChatId ->
                            navController.navigate("call?chatId=${Uri.encode(selectedChatId)}")
                        },
                        onOpenGroupInfo = { selectedChatId ->
                            navController.navigate("group/${Uri.encode(selectedChatId)}")
                        },
                        onOpenMedia = { selectedChatId ->
                            navController.navigate("media/${Uri.encode(selectedChatId)}")
                        }
                    )
                }

                composable("contacts") {
                    ContactListScreen(
                        paddingValues = padding,
                        viewModel = contactListViewModel,
                        onOpenConversation = { chatId, title ->
                            navController.navigate(conversationRoute(chatId, title))
                        },
                        onOpenCreateGroup = { navController.navigate("group/create") }
                    )
                }

                composable("group/create") {
                    CreateGroupScreen(
                        viewModel = groupViewModel,
                        onOpenGroupInfo = { chatId ->
                            navController.navigate("group/${Uri.encode(chatId)}")
                        },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("group/{chatId}") { backStackEntry ->
                    val chatId = backStackEntry.arguments?.getString("chatId").orEmpty()
                    GroupInfoScreen(
                        chatId = chatId,
                        viewModel = groupViewModel,
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("media/{chatId}") { backStackEntry ->
                    val chatId = backStackEntry.arguments?.getString("chatId").orEmpty()
                    MediaGallery(
                        chatId = chatId,
                        viewModel = mediaViewModel,
                        onOpenViewer = { uploadId ->
                            navController.navigate("media/view/${Uri.encode(uploadId)}")
                        },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("media/view/{uploadId}") { backStackEntry ->
                    val uploadId = backStackEntry.arguments?.getString("uploadId").orEmpty()
                    ImageViewer(
                        uploadId = uploadId,
                        viewModel = mediaViewModel,
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("call") {
                    CallScreen(
                        viewModel = callViewModel,
                        initialChatId = null,
                        onOpenGroupCall = { navController.navigate("group-call") },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("call?chatId={chatId}") { backStackEntry ->
                    val chatId = backStackEntry.arguments?.getString("chatId")
                    CallScreen(
                        viewModel = callViewModel,
                        initialChatId = chatId,
                        onOpenGroupCall = { navController.navigate("group-call") },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("group-call") {
                    GroupCallScreen(
                        viewModel = callViewModel,
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("incoming-call") {
                    IncomingCallScreen(
                        onAccept = { navController.navigate("call") },
                        onReject = { navController.popBackStack() }
                    )
                }

                composable("settings") {
                    SettingsScreen(
                        paddingValues = padding,
                        username = session.username,
                        userId = session.userId,
                        deviceId = session.deviceId,
                        secureStorageSummary = "${container.secureStorageStatus.summary()}, signing: ${container.signingStorageSummary}",
                        socketSummary = buildString {
                            append(socketConnectionState.name.lowercase())
                            append(", reconnect_attempt=")
                            append(socketDiagnostics.reconnectAttempt)
                            socketDiagnostics.lastDisconnectCode?.let { code ->
                                append(", last_disconnect_code=")
                                append(code)
                            }
                            socketDiagnostics.lastDisconnectReason?.takeIf { it.isNotBlank() }?.let { reason ->
                                append(", last_reason=")
                                append(reason)
                            }
                        },
                        socketEvents = socketLog,
                        onForceReconnect = { container.webSocketManager.forceReconnect() },
                        onClearSocketLog = { container.webSocketManager.clearDiagnosticLog() },
                        onOpenDevices = {
                            settingsViewModel.refreshDevices()
                            navController.navigate("settings/devices")
                        },
                        onOpenPrivacy = { navController.navigate("settings/privacy") },
                        onOpenProfile = { navController.navigate("settings/profile") },
                        onOpenSafetyNumbers = { navController.navigate("settings/safety") },
                        onLogout = authViewModel::logout
                    )
                }

                composable("settings/devices") {
                    DevicesScreen(
                        viewModel = settingsViewModel,
                        onBackToSettings = { navController.popBackStack() }
                    )
                }

                composable("settings/privacy") {
                    PrivacySettingsScreen(
                        viewModel = settingsViewModel,
                        onBackToSettings = { navController.popBackStack() }
                    )
                }

                composable("settings/profile") {
                    ProfileScreen(
                        username = session.username,
                        userId = session.userId,
                        deviceId = session.deviceId,
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("settings/safety") {
                    SafetyNumberScreen(
                        viewModel = groupViewModel,
                        onBack = { navController.popBackStack() }
                    )
                }
            }
        }
    }
}

@Composable
private fun rememberConnectivityManager(context: Context): ConnectivityManager {
    return remember(context) {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
}

private fun isNetworkAvailable(connectivityManager: ConnectivityManager): Boolean {
    val activeNetwork = connectivityManager.activeNetwork ?: return false
    val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
