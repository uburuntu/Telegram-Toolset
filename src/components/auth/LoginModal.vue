<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore, useUiStore } from '@/stores'
import { getBotInfo, isValidTokenFormat, maskBotToken } from '@/services/telegram/bot-api'
import { telegramService } from '@/services/telegram/client'
import type { AccountType, SavedAccount } from '@/types'
import type { BotApiUser } from '@/services/telegram/bot-api'

// Auth flow promise - resolves when full auth completes
let authPromise: Promise<void> | null = null

const props = defineProps<{
  requiredType?: 'user' | 'bot' | 'any'
  targetRoute?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

// Track what was active before opening the modal so we can restore the session if user cancels.
const previousActiveAccountId = accountsStore.activeAccountId

// State - initialize step based on required type and existing credentials
const activeTab = ref<AccountType>(props.requiredType === 'bot' ? 'bot' : 'user')
const getInitialStep = ():
  | 'credentials-choice'
  | 'credentials'
  | 'phone'
  | 'code'
  | 'password'
  | 'token'
  | 'success' => {
  if (props.requiredType === 'bot') return 'token'
  // If we have stored API credentials, show choice screen
  if (accountsStore.storedApiCredentials) return 'credentials-choice'
  return 'credentials'
}
const step = ref<
  'credentials-choice' | 'credentials' | 'phone' | 'code' | 'password' | 'token' | 'success'
>(getInitialStep())
const isLoading = ref(false)
const error = ref('')

// User account fields
const apiId = ref('')
const apiHash = ref('')
const phone = ref('')
const code = ref('')
const password = ref('')

// Bot fields
const botToken = ref('')
const botTokenDisplay = ref('') // Masked version for display
const botInfo = ref<BotApiUser | null>(null)
const isValidatingToken = ref(false)
const tokenValidated = ref(false)
// NOTE: "tokenValidationWarning" path removed per issue #4 - bot tokens must validate successfully.
const existingBotAccount = ref<SavedAccount | null>(null)

// Computed
const canSwitchTabs = computed(() => props.requiredType === 'any' || !props.requiredType)

// Watch tab changes
watch(activeTab, () => {
  resetForm()
})

function resetForm(): void {
  if (activeTab.value === 'user') {
    step.value = accountsStore.storedApiCredentials ? 'credentials-choice' : 'credentials'
  } else {
    step.value = 'token'
  }
  error.value = ''
  apiId.value = ''
  apiHash.value = ''
  phone.value = ''
  code.value = ''
  password.value = ''
  botToken.value = ''
  botTokenDisplay.value = ''
  botInfo.value = null
  tokenValidated.value = false
  existingBotAccount.value = null
}

// Handle bot token input with auto-validation
async function handleTokenInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const value = input.value

  // Store the real token
  botToken.value = value

  // If it looks like a valid token, mask it and validate
  if (isValidTokenFormat(value)) {
    botTokenDisplay.value = maskBotToken(value)
    await validateBotToken(value)
  } else {
    botTokenDisplay.value = value
    tokenValidated.value = false
    botInfo.value = null
  }
}

// Handle paste event for auto-validation
async function handleTokenPaste(event: ClipboardEvent): Promise<void> {
  const pastedText = event.clipboardData?.getData('text') || ''

  if (isValidTokenFormat(pastedText)) {
    event.preventDefault()
    botToken.value = pastedText
    botTokenDisplay.value = maskBotToken(pastedText)
    await validateBotToken(pastedText)
  }
}

async function validateBotToken(token: string): Promise<void> {
  isValidatingToken.value = true
  error.value = ''
  tokenValidated.value = false
  botInfo.value = null
  existingBotAccount.value = null

  try {
    const info = await getBotInfo(token)
    botInfo.value = info
    tokenValidated.value = true

    // Check for duplicate bot
    const existing = accountsStore.findBotByTelegramId(info.id)
    if (existing) {
      existingBotAccount.value = existing
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid bot token'
    // Validation must succeed before adding a bot. No "add without validation" path.
    error.value = message
    tokenValidated.value = false
  } finally {
    isValidatingToken.value = false
  }
}

function useSavedCredentials(): void {
  const creds = accountsStore.storedApiCredentials
  if (creds) {
    apiId.value = String(creds.apiId)
    apiHash.value = creds.apiHash
    accountsStore.setAuthFlowApiCredentials(creds.apiId, creds.apiHash)
    step.value = 'phone'
  }
}

async function handleCredentialsSubmit(): Promise<void> {
  error.value = ''

  const id = parseInt(apiId.value, 10)
  if (isNaN(id) || id <= 0) {
    error.value = 'API ID must be a positive number'
    return
  }

  if (!apiHash.value || apiHash.value.length < 10) {
    error.value = 'API Hash must be at least 10 characters'
    return
  }

  accountsStore.setAuthFlowApiCredentials(id, apiHash.value)
  step.value = 'phone'
}

async function handlePhoneSubmit(): Promise<void> {
  error.value = ''
  if (!phone.value || phone.value.length < 5) {
    error.value = 'Please enter a valid phone number'
    return
  }

  isLoading.value = true
  try {
    // IMPORTANT: Always start a *fresh* session for a new phone login.
    // Otherwise we can accidentally reuse another account's existing session and appear "already logged in".
    if (typeof (telegramService as any).resetForNewUserLogin === 'function') {
      await (telegramService as any).resetForNewUserLogin()
    } else {
      // Fallback for mocks/older builds
      try {
        await telegramService.disconnect()
      } catch {
        // ignore
      }
      telegramService.restoreSession('')
    }

    // Initialize and connect the Telegram client
    const id = parseInt(apiId.value, 10)
    await telegramService.initClient(id, apiHash.value)
    await telegramService.connect()

    // Start auth flow - this will send the code and wait for it
    // We run this in the background and move to code step
    authPromise = telegramService
      .startUserAuth(phone.value)
      .then((user) => {
        // Auth completed successfully
        const newAccount = accountsStore.addAccount({
          type: 'user',
          label: user.firstName || 'User ' + phone.value.slice(-4),
          phone: phone.value,
          apiId: id,
          apiHash: apiHash.value,
          sessionString: telegramService.getSessionString(),
        })
        accountsStore.setActiveAccount(newAccount.id)
        step.value = 'success'
        uiStore.showToast('success', 'Account added successfully!')
        setTimeout(() => {
          handleClose()
          if (props.targetRoute) {
            router.push(props.targetRoute)
          }
        }, 1000)
      })
      .catch((e: any) => {
        if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          step.value = 'password'
        } else {
          error.value = e.message || 'Authentication failed'
        }
      })

    // Move to code entry step - GramJS is waiting for the code
    step.value = 'code'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to send code'
  } finally {
    isLoading.value = false
  }
}

async function handleCodeSubmit(): Promise<void> {
  error.value = ''
  if (!code.value || code.value.length < 4) {
    error.value = 'Please enter the verification code'
    return
  }

  isLoading.value = true
  try {
    // Provide the code to the waiting auth flow
    telegramService.provideCode(code.value)

    // Wait for the auth promise to complete
    if (authPromise) {
      await authPromise
    }
  } catch (e: any) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      step.value = 'password'
    } else {
      error.value = e instanceof Error ? e.message : 'Failed to verify code'
    }
  } finally {
    isLoading.value = false
  }
}

async function handlePasswordSubmit(): Promise<void> {
  error.value = ''
  if (!password.value) {
    error.value = 'Please enter your 2FA password'
    return
  }

  isLoading.value = true
  try {
    // Provide the password to the waiting auth flow
    telegramService.providePassword(password.value)

    // Wait for the auth promise to complete
    if (authPromise) {
      await authPromise
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Incorrect password'
  } finally {
    isLoading.value = false
  }
}

async function handleBotTokenSubmit(): Promise<void> {
  if (!tokenValidated.value || !botInfo.value) {
    error.value = 'Please enter a valid bot token'
    return
  }

  isLoading.value = true
  try {
    let accountId: string

    if (existingBotAccount.value) {
      // Update existing bot account
      accountsStore.updateAccount(existingBotAccount.value.id, {
        label: botInfo.value.first_name,
        firstName: botInfo.value.first_name,
        username: botInfo.value.username,
        botToken: botToken.value,
        canJoinGroups: botInfo.value.can_join_groups,
        canReadAllGroupMessages: botInfo.value.can_read_all_group_messages,
        supportsInlineQueries: botInfo.value.supports_inline_queries,
        hasMainWebApp: botInfo.value.has_main_web_app,
      })
      accountId = existingBotAccount.value.id
      uiStore.showToast('success', `${botInfo.value.first_name} updated successfully!`)
    } else {
      // Add new bot account
      const newAccount = accountsStore.addAccount({
        type: 'bot',
        label: botInfo.value.first_name,
        firstName: botInfo.value.first_name,
        username: botInfo.value.username,
        botToken: botToken.value,
        botTelegramId: botInfo.value.id,
        canJoinGroups: botInfo.value.can_join_groups,
        canReadAllGroupMessages: botInfo.value.can_read_all_group_messages,
        supportsInlineQueries: botInfo.value.supports_inline_queries,
        hasMainWebApp: botInfo.value.has_main_web_app,
        sessionString: 'bot_session_' + Date.now(),
      })
      accountId = newAccount.id
      uiStore.showToast('success', `${botInfo.value.first_name} added successfully!`)
    }

    accountsStore.setActiveAccount(accountId)
    step.value = 'success'

    setTimeout(() => {
      handleClose()
      if (props.targetRoute) {
        router.push(props.targetRoute)
      }
    }, 1000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to add bot'
  } finally {
    isLoading.value = false
  }
}

function handleClose(): void {
  accountsStore.resetAuthFlow()
  emit('close')
  uiStore.closeModal()

  // If user cancels mid-flow, restore previous active user session (best-effort).
  // This prevents leaving the app in a "disconnected" state after attempting to add another account.
  const prev = accountsStore.accounts.find((a) => a.id === previousActiveAccountId)
  if (prev?.type === 'user' && prev.apiId && prev.apiHash) {
    const svc: any = telegramService as any
    if (typeof svc.useUserAccountSession === 'function') {
      svc
        .useUserAccountSession({
          sessionString: prev.sessionString,
          apiId: prev.apiId,
          apiHash: prev.apiHash,
        })
        .catch(() => {
          // ignore
        })
    }
  }
}

function goBack(): void {
  error.value = ''
  if (step.value === 'credentials') {
    // If we have stored creds, go back to choice screen
    if (accountsStore.storedApiCredentials) {
      step.value = 'credentials-choice'
    }
  } else if (step.value === 'phone') {
    // Go back to credentials or credentials-choice
    if (accountsStore.storedApiCredentials) {
      step.value = 'credentials-choice'
    } else {
      step.value = 'credentials'
    }
  } else if (step.value === 'code') {
    step.value = 'phone'
  } else if (step.value === 'password') {
    step.value = 'code'
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    @click.self="handleClose"
  >
    <div
      class="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Add Account</h2>
        <button
          @click="handleClose"
          class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150"
        >
          ✕
        </button>
      </div>

      <!-- Tabs -->
      <div
        v-if="canSwitchTabs && step !== 'success'"
        class="flex mb-5 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg"
      >
        <button
          data-testid="tab-user"
          @click="activeTab = 'user'"
          :class="[
            'flex-1 py-2 text-sm font-medium rounded-md transition-all duration-150',
            activeTab === 'user'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          ]"
        >
          👤 User Account
        </button>
        <button
          data-testid="tab-bot"
          @click="activeTab = 'bot'"
          :class="[
            'flex-1 py-2 text-sm font-medium rounded-md transition-all duration-150',
            activeTab === 'bot'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          ]"
        >
          🤖 Bot Token
        </button>
      </div>

      <!-- User Account Flow -->
      <template v-if="activeTab === 'user'">
        <!-- Step 0: Credentials Choice (when saved creds exist) -->
        <template v-if="step === 'credentials-choice'">
          <div
            class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm"
          >
            <p class="text-blue-800 dark:text-blue-300 mb-2">
              <strong>API credentials found</strong>
            </p>
            <p class="text-blue-700 dark:text-blue-400 text-xs">
              You have API credentials saved from a previous login. The same credentials can be used
              for multiple Telegram accounts.
            </p>
          </div>

          <div class="space-y-3">
            <!-- Use saved credentials -->
            <button
              @click="useSavedCredentials"
              class="w-full p-3 text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors duration-150"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center text-blue-600"
                >
                  ✓
                </div>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white text-sm">
                    Use saved credentials
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    API ID: {{ accountsStore.storedApiCredentials?.apiId }}
                  </p>
                </div>
              </div>
            </button>

            <!-- Enter new credentials -->
            <button
              @click="step = 'credentials'"
              class="w-full p-3 text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-150"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500"
                >
                  +
                </div>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white text-sm">
                    Enter different credentials
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Use a different API ID & Hash
                  </p>
                </div>
              </div>
            </button>
          </div>
        </template>

        <!-- Step 1: API Credentials -->
        <template v-else-if="step === 'credentials'">
          <button
            v-if="accountsStore.storedApiCredentials"
            @click="goBack"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-150"
          >
            ← Back
          </button>

          <!-- API Explanation -->
          <div
            class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm"
          >
            <p class="text-blue-800 dark:text-blue-300 mb-2">
              <strong>Why do I need API credentials?</strong>
            </p>
            <p class="text-blue-700 dark:text-blue-400 text-xs">
              To connect as a user (not a bot), you need your own app credentials from Telegram.
              This is like a developer key that identifies your connection. Get them free at
              <a href="https://my.telegram.org/auth" target="_blank" class="underline"
                >my.telegram.org</a
              >.
            </p>
          </div>

          <form @submit.prevent="handleCredentialsSubmit" class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >API ID</label
              >
              <input
                v-model="apiId"
                type="text"
                inputmode="numeric"
                placeholder="123456"
                spellcheck="false"
                autocomplete="off"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                required
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >API Hash</label
              >
              <input
                v-model="apiHash"
                type="text"
                placeholder="0123456789abcdef..."
                spellcheck="false"
                autocomplete="off"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                required
              />
            </div>
            <div v-if="error" class="text-red-600 text-sm">{{ error }}</div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
            >
              Continue
            </button>
          </form>
        </template>

        <!-- Step 2: Phone -->
        <template v-else-if="step === 'phone'">
          <button
            @click="goBack"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-150"
          >
            ← Back
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Enter your phone number to receive a verification code
          </p>

          <form @submit.prevent="handlePhoneSubmit" class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >Phone Number</label
              >
              <input
                v-model="phone"
                type="tel"
                placeholder="+1234567890"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                required
                autofocus
              />
            </div>
            <div v-if="error" class="text-red-600 text-sm">{{ error }}</div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-150"
              :disabled="isLoading"
            >
              {{ isLoading ? 'Sending...' : 'Send Code' }}
            </button>
          </form>
        </template>

        <!-- Step 3: Code -->
        <template v-else-if="step === 'code'">
          <button
            @click="goBack"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-150"
          >
            ← Back
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Enter the code sent to {{ phone }}
          </p>

          <form @submit.prevent="handleCodeSubmit" class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >Verification Code</label
              >
              <input
                v-model="code"
                type="text"
                inputmode="numeric"
                placeholder="12345"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center text-xl tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                required
                autofocus
              />
            </div>
            <div v-if="error" class="text-red-600 text-sm">{{ error }}</div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-150"
              :disabled="isLoading"
            >
              {{ isLoading ? 'Verifying...' : 'Verify' }}
            </button>
          </form>
        </template>

        <!-- Step 4: 2FA Password -->
        <template v-else-if="step === 'password'">
          <button
            @click="goBack"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-150"
          >
            ← Back
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Enter your two-factor authentication password
          </p>

          <form @submit.prevent="handlePasswordSubmit" class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >Password</label
              >
              <input
                v-model="password"
                type="password"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                required
                autofocus
              />
            </div>
            <div v-if="error" class="text-red-600 text-sm">{{ error }}</div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-150"
              :disabled="isLoading"
            >
              {{ isLoading ? 'Signing in...' : 'Sign In' }}
            </button>
          </form>
        </template>
      </template>

      <!-- Bot Token Flow -->
      <template v-if="activeTab === 'bot' && step === 'token'">
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Get your bot token from
          <a href="https://t.me/BotFather" target="_blank" class="text-purple-600 hover:underline">
            @BotFather
          </a>
        </p>

        <form @submit.prevent="handleBotTokenSubmit" class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >Bot Token</label
            >
            <div class="relative">
              <input
                :value="botTokenDisplay"
                @input="handleTokenInput"
                @paste="handleTokenPaste"
                type="text"
                placeholder="Paste your bot token here"
                spellcheck="false"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                class="w-full px-3 py-2 pr-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-150"
                :class="{
                  'border-green-500 dark:border-green-500': tokenValidated,
                  'border-red-500 dark:border-red-500': error && botToken,
                }"
                required
                autofocus
              />
              <!-- Validation indicator -->
              <div class="absolute right-3 top-1/2 -translate-y-1/2">
                <svg
                  v-if="isValidatingToken"
                  class="animate-spin w-4 h-4 text-purple-600"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span v-else-if="tokenValidated" class="text-green-500">✓</span>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Token is masked for your privacy when screen sharing
            </p>
          </div>

          <!-- Bot Info Preview -->
          <div
            v-if="botInfo"
            class="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center text-white text-lg"
              >
                🤖
              </div>
              <div>
                <p class="font-medium text-gray-900 dark:text-white">{{ botInfo.first_name }}</p>
                <p class="text-sm text-gray-500">@{{ botInfo.username }}</p>
              </div>
            </div>
          </div>

          <!-- Duplicate Bot Warning -->
          <div
            v-if="existingBotAccount"
            class="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-sm"
          >
            <p class="text-amber-700 dark:text-amber-300">
              ⚠️ This bot is already added. Proceeding will update the existing token.
            </p>
          </div>

          <div v-if="error" class="text-red-600 text-sm">{{ error }}</div>

          <button
            type="submit"
            class="w-full px-4 py-2 rounded-md font-medium text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors duration-150"
            :disabled="isLoading || !tokenValidated"
          >
            <template v-if="isLoading">{{
              existingBotAccount ? 'Updating...' : 'Adding...'
            }}</template>
            <template v-else-if="tokenValidated && existingBotAccount"
              >Update {{ botInfo?.first_name }}</template
            >
            <template v-else-if="tokenValidated">Add {{ botInfo?.first_name }}</template>
            <template v-else>Enter a valid token</template>
          </button>
        </form>
      </template>

      <!-- Success -->
      <template v-if="step === 'success'">
        <div class="text-center py-6">
          <div class="text-4xl mb-3">✅</div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">Account Added!</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400">Redirecting...</p>
        </div>
      </template>

      <!-- Privacy Notice -->
      <div
        v-if="step !== 'success'"
        class="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded text-xs text-gray-500 dark:text-gray-400"
      >
        🔒 Your credentials are stored locally in your browser and never sent to any server.
      </div>
    </div>
  </div>
</template>
