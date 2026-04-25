<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { BotApiUser } from '@/services/telegram/bot-api'
import { getBotInfo, isValidTokenFormat, maskBotToken } from '@/services/telegram/bot-api'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore, useUiStore } from '@/stores'
import type { AccountType, SavedAccount, UserInfo } from '@/types'

const props = defineProps<{
  requiredType?: 'user' | 'bot' | 'any'
  targetRoute?: string
  replaceAccountId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const router = useRouter()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()
const replacementUserAccount = computed(() => {
  if (!props.replaceAccountId) {
    return null
  }

  const account = accountsStore.accounts.find((entry) => entry.id === props.replaceAccountId)
  return account?.type === 'user' ? account : null
})
const dialogTitle = computed(() =>
  replacementUserAccount.value ? t('auth.logInAgain') : t('auth.addAccount'),
)
const replacementAccountLabel = computed(
  () => replacementUserAccount.value?.firstName || replacementUserAccount.value?.label || '',
)

const dialogTitleId = 'login-modal-title'
const apiIdInputId = 'login-modal-api-id'
const apiHashInputId = 'login-modal-api-hash'
const phoneInputId = 'login-modal-phone'
const codeInputId = 'login-modal-code'
const passwordInputId = 'login-modal-password'
const passwordHintId = 'login-modal-password-hint'
const botTokenInputId = 'login-modal-bot-token'
const credentialsErrorId = 'login-modal-credentials-error'
const phoneErrorId = 'login-modal-phone-error'
const codeErrorId = 'login-modal-code-error'
const passwordErrorId = 'login-modal-password-error'
const botTokenErrorId = 'login-modal-bot-error'

type LoginStep =
  | 'credentials-choice'
  | 'credentials'
  | 'phone'
  | 'code'
  | 'password'
  | 'token'
  | 'success'
type RecoverableAuthStage = 'code' | 'password'

// State - initialize step based on required type and existing credentials
const activeTab = ref<AccountType>(props.requiredType === 'bot' ? 'bot' : 'user')
const getInitialStep = (): LoginStep => {
  if (props.requiredType === 'bot') return 'token'
  if (replacementUserAccount.value) {
    return accountsStore.apiCredentials ? 'phone' : 'credentials'
  }
  // If we have stored API credentials, show choice screen
  if (accountsStore.apiCredentials) return 'credentials-choice'
  return 'credentials'
}
const step = ref<LoginStep>(getInitialStep())
const pendingSubmissionStep = ref<LoginStep | null>(null)
const availableAuthInputStage = ref<RecoverableAuthStage | null>(null)
const error = ref('')
let successCloseTimer: ReturnType<typeof setTimeout> | null = null
const dialogRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const apiIdInputRef = ref<HTMLInputElement | null>(null)
const phoneInputRef = ref<HTMLInputElement | null>(null)
const codeInputRef = ref<HTMLInputElement | null>(null)
const passwordInputRef = ref<HTMLInputElement | null>(null)
const botTokenInputRef = ref<HTMLInputElement | null>(null)
let previousFocusedElement: HTMLElement | null = null

// User account fields
const apiId = ref('')
const apiHash = ref('')
const phone = ref('')
const code = ref('')
const password = ref('')
const passwordHint = ref<string | undefined>(undefined)

// Bot fields
const botToken = ref('')
const botTokenDisplay = ref('') // Masked version for display
const botInfo = ref<BotApiUser | null>(null)
const isValidatingToken = ref(false)
const tokenValidated = ref(false)
// NOTE: "tokenValidationWarning" path removed per issue #4 - bot tokens must validate successfully.
const existingBotAccount = ref<SavedAccount | null>(null)
const userAuthPromise = ref<Promise<UserInfo> | null>(null)
let userAuthAttemptId = 0
let botValidationRequestId = 0

function seedReplacementUserFields(): void {
  if (activeTab.value !== 'user' || !replacementUserAccount.value) {
    return
  }

  phone.value = replacementUserAccount.value.phone || ''

  if (accountsStore.apiCredentials) {
    apiId.value = String(accountsStore.apiCredentials.apiId)
    apiHash.value = accountsStore.apiCredentials.apiHash
  }
}

seedReplacementUserFields()

// Computed
const canSwitchTabs = computed(() => {
  if (props.requiredType && props.requiredType !== 'any') {
    return false
  }

  return (
    step.value === 'credentials-choice' ||
    step.value === 'credentials' ||
    step.value === 'phone' ||
    step.value === 'token'
  )
})
const isSubmittingPhone = computed(() => pendingSubmissionStep.value === 'phone')
const isSubmittingCode = computed(() => pendingSubmissionStep.value === 'code')
const isSubmittingPassword = computed(() => pendingSubmissionStep.value === 'password')
const isSubmittingBot = computed(() => pendingSubmissionStep.value === 'token')
const isBusy = computed(() => pendingSubmissionStep.value !== null)
const isCodePromptReady = computed(() => availableAuthInputStage.value === 'code')
const isPasswordPromptReady = computed(() => availableAuthInputStage.value === 'password')
const currentErrorId = computed(() => {
  switch (step.value) {
    case 'credentials':
      return credentialsErrorId
    case 'phone':
      return phoneErrorId
    case 'code':
      return codeErrorId
    case 'password':
      return passwordErrorId
    case 'token':
      return botTokenErrorId
    default:
      return undefined
  }
})

// Watch tab changes
watch(activeTab, () => {
  resetForm()
})
watch([activeTab, step], () => {
  void nextTick(() => {
    focusPrimaryControl()
  })
})

function resetForm(): void {
  invalidateUserAuth()
  invalidateBotTokenValidation()
  if (activeTab.value === 'user') {
    step.value = getInitialStep()
  } else {
    step.value = 'token'
  }
  pendingSubmissionStep.value = null
  availableAuthInputStage.value = null
  error.value = ''
  apiId.value = ''
  apiHash.value = ''
  phone.value = ''
  code.value = ''
  password.value = ''
  passwordHint.value = undefined
  botToken.value = ''
  botTokenDisplay.value = ''
  botInfo.value = null
  tokenValidated.value = false
  existingBotAccount.value = null
  seedReplacementUserFields()
}

function getErrorMessage(authError: unknown, fallbackKey: string): string {
  if (authError && typeof authError === 'object') {
    const candidate = authError as { message?: string; errorMessage?: string }
    return candidate.message || candidate.errorMessage || t(fallbackKey)
  }

  return t(fallbackKey)
}

function invalidateUserAuth(): void {
  userAuthAttemptId += 1
  userAuthPromise.value = null
  availableAuthInputStage.value = null
}

function invalidateBotTokenValidation(): void {
  botValidationRequestId += 1
  isValidatingToken.value = false
}

function buildDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(' ')
  return value || undefined
}

function getFocusableElements(): HTMLElement[] {
  if (!dialogRef.value) {
    return []
  }

  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

function getPrimaryFocusTarget(): HTMLElement | null {
  if (step.value === 'success') {
    return closeButtonRef.value ?? dialogRef.value
  }

  if (activeTab.value === 'bot' && step.value === 'token') {
    return botTokenInputRef.value ?? closeButtonRef.value ?? dialogRef.value
  }

  switch (step.value) {
    case 'credentials':
      return apiIdInputRef.value ?? closeButtonRef.value ?? dialogRef.value
    case 'phone':
      return phoneInputRef.value ?? closeButtonRef.value ?? dialogRef.value
    case 'code':
      return codeInputRef.value ?? closeButtonRef.value ?? dialogRef.value
    case 'password':
      return passwordInputRef.value ?? closeButtonRef.value ?? dialogRef.value
    default:
      return closeButtonRef.value ?? dialogRef.value
  }
}

function focusPrimaryControl(): void {
  getPrimaryFocusTarget()?.focus()
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void handleClose()
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusableElements = getFocusableElements()

  if (focusableElements.length === 0) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }

  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  const focusedElement =
    document.activeElement instanceof HTMLElement &&
    focusableElements.includes(document.activeElement)
      ? document.activeElement
      : event.target instanceof HTMLElement
        ? event.target
        : null

  if (event.shiftKey && focusedElement === firstElement) {
    event.preventDefault()
    lastElement?.focus()
    return
  }

  if (!event.shiftKey && focusedElement === lastElement) {
    event.preventDefault()
    firstElement?.focus()
  }
}

function restartUserAuthFlow(): void {
  invalidateUserAuth()
  pendingSubmissionStep.value = null
  error.value = ''
  code.value = ''
  password.value = ''
  passwordHint.value = undefined
  step.value = 'phone'

  const svc: any = telegramService as any
  if (typeof svc.resetForNewUserLogin === 'function') {
    svc.resetForNewUserLogin().catch(() => {
      // Ignore best-effort cleanup.
    })
  }
}

function handleRecoverableAuthError(authError: unknown, stage: RecoverableAuthStage): void {
  error.value = getErrorMessage(
    authError,
    stage === 'password' ? 'auth.errors.incorrectPassword' : 'auth.errors.verifyCodeFailed',
  )
  pendingSubmissionStep.value = null
  availableAuthInputStage.value = null

  if (stage === 'password') {
    password.value = ''
    step.value = 'password'
    return
  }

  code.value = ''
  step.value = 'code'
}

async function finalizeUserAuth(user: UserInfo): Promise<void> {
  const sessionString = telegramService.getSessionString()
  let accountId: string

  if (replacementUserAccount.value) {
    accountsStore.updateAccount(replacementUserAccount.value.id, {
      label:
        user.firstName || replacementUserAccount.value.label || `User ${phone.value.slice(-4)}`,
      firstName: user.firstName || replacementUserAccount.value.firstName,
      username: user.username,
      phone: phone.value,
      sessionString,
    })
    accountId = replacementUserAccount.value.id
    uiStore.showToast('success', t('auth.reloginSuccess'))
  } else {
    const newAccount = accountsStore.addAccount({
      type: 'user',
      label: user.firstName || `User ${phone.value.slice(-4)}`,
      firstName: user.firstName,
      username: user.username,
      phone: phone.value,
      sessionString,
    })
    accountId = newAccount.id
    uiStore.showToast('success', t('auth.success'))
  }

  accountsStore.markAccountSessionReady(accountId)
  accountsStore.setActiveAccount(accountId)
  pendingSubmissionStep.value = null
  step.value = 'success'

  clearSuccessCloseTimer()
  successCloseTimer = setTimeout(() => {
    handleClose()
    if (props.targetRoute) {
      router.push(props.targetRoute)
    }
  }, 1000)
}

async function observeUserAuth(pendingAuth: Promise<UserInfo>, attemptId: number): Promise<void> {
  try {
    const user = await pendingAuth
    if (userAuthPromise.value !== pendingAuth || userAuthAttemptId !== attemptId) {
      return
    }

    invalidateUserAuth()
    await finalizeUserAuth(user)
  } catch (authError) {
    if (userAuthPromise.value !== pendingAuth || userAuthAttemptId !== attemptId) {
      return
    }

    invalidateUserAuth()
    pendingSubmissionStep.value = null
    error.value = getErrorMessage(authError, 'auth.errors.authenticationFailed')
  }
}

function ensureActiveUserAuth(): boolean {
  if (userAuthPromise.value) {
    return true
  }

  pendingSubmissionStep.value = null
  error.value = t('auth.errors.loginFlowExpired')
  step.value = 'phone'
  return false
}

function clearSuccessCloseTimer(): void {
  if (successCloseTimer !== null) {
    clearTimeout(successCloseTimer)
    successCloseTimer = null
  }
}

onMounted(() => {
  previousFocusedElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  void nextTick(() => {
    focusPrimaryControl()
  })
})

onUnmounted(() => {
  clearSuccessCloseTimer()
  if (step.value !== 'success') {
    void telegramService.abortCurrentUserAuth()
  }
  previousFocusedElement?.focus()
})

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
    invalidateBotTokenValidation()
    botTokenDisplay.value = value
    error.value = ''
    tokenValidated.value = false
    botInfo.value = null
    existingBotAccount.value = null
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
  const requestId = ++botValidationRequestId
  isValidatingToken.value = true
  error.value = ''
  tokenValidated.value = false
  botInfo.value = null
  existingBotAccount.value = null

  try {
    const info = await getBotInfo(token)
    if (requestId !== botValidationRequestId || token !== botToken.value) {
      return
    }

    botInfo.value = info
    tokenValidated.value = true

    // Check for duplicate bot
    const existing = accountsStore.findBotByTelegramId(info.id)
    if (existing) {
      existingBotAccount.value = existing
    }
  } catch (e) {
    if (requestId !== botValidationRequestId || token !== botToken.value) {
      return
    }

    const message = e instanceof Error ? e.message : t('auth.validation.botToken')
    // Validation must succeed before adding a bot. No "add without validation" path.
    error.value = message
    tokenValidated.value = false
  } finally {
    if (requestId === botValidationRequestId) {
      isValidatingToken.value = false
    }
  }
}

function useSavedCredentials(): void {
  if (accountsStore.apiCredentials) {
    apiId.value = String(accountsStore.apiCredentials.apiId)
    apiHash.value = accountsStore.apiCredentials.apiHash
    step.value = 'phone'
    if (replacementUserAccount.value?.phone) {
      phone.value = replacementUserAccount.value.phone
    }
  }
}

async function handleCredentialsSubmit(): Promise<void> {
  error.value = ''

  const id = parseInt(apiId.value, 10)
  if (Number.isNaN(id) || id <= 0) {
    error.value = t('auth.validation.apiId')
    return
  }

  if (!apiHash.value || apiHash.value.length < 10) {
    error.value = t('auth.validation.apiHash')
    return
  }

  accountsStore.setApiCredentials({ apiId: id, apiHash: apiHash.value })
  step.value = 'phone'
}

async function handlePhoneSubmit(): Promise<void> {
  error.value = ''
  if (!phone.value || phone.value.length < 5) {
    error.value = t('auth.validation.phone')
    return
  }

  pendingSubmissionStep.value = 'phone'
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

    // Initialize the Telegram client (but don't connect yet - client.start() does that).
    const id = parseInt(apiId.value, 10)
    await telegramService.initClient(id, apiHash.value)

    // Start auth flow - client.start() handles connect + sendCode + waitForCode internally
    // We run this in the background and move to code step
    passwordHint.value = undefined
    code.value = ''
    password.value = ''

    const pendingAuth = telegramService.startUserAuth(phone.value, {
      onCodeNeeded: () => {
        availableAuthInputStage.value = 'code'
        step.value = 'code'
        pendingSubmissionStep.value = null
      },
      onPasswordNeeded: (hint) => {
        passwordHint.value = hint
        password.value = ''
        availableAuthInputStage.value = 'password'
        step.value = 'password'
        pendingSubmissionStep.value = null
      },
      onRecoverableError: (authError, stage) => {
        handleRecoverableAuthError(authError, stage)
      },
    })

    const attemptId = ++userAuthAttemptId
    userAuthPromise.value = pendingAuth
    void observeUserAuth(pendingAuth, attemptId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('auth.errors.sendCodeFailed')
  } finally {
    if (pendingSubmissionStep.value === 'phone') {
      pendingSubmissionStep.value = null
    }
  }
}

async function handleCodeSubmit(): Promise<void> {
  error.value = ''
  if (!code.value || code.value.length < 4) {
    error.value = t('auth.validation.code')
    return
  }

  if (!ensureActiveUserAuth()) {
    return
  }

  if (!isCodePromptReady.value) {
    error.value = t('auth.errors.loginFlowExpired')
    return
  }

  availableAuthInputStage.value = null
  pendingSubmissionStep.value = 'code'

  // Provide the code to the waiting auth flow. Completion is observed separately so the UI
  // can stay responsive while GramJS waits for either the next prompt or final success.
  if (!telegramService.provideCode(code.value)) {
    pendingSubmissionStep.value = null
    error.value = t('auth.errors.loginFlowExpired')
  }
}

async function handlePasswordSubmit(): Promise<void> {
  error.value = ''
  if (!password.value) {
    error.value = t('auth.validation.password')
    return
  }

  if (!ensureActiveUserAuth()) {
    return
  }

  if (!isPasswordPromptReady.value) {
    error.value = t('auth.errors.loginFlowExpired')
    return
  }

  availableAuthInputStage.value = null
  pendingSubmissionStep.value = 'password'

  // Provide the password to the waiting auth flow. Completion is observed separately.
  if (!telegramService.providePassword(password.value)) {
    pendingSubmissionStep.value = null
    error.value = t('auth.errors.loginFlowExpired')
  }
}

async function handleBotTokenSubmit(): Promise<void> {
  if (!tokenValidated.value || !botInfo.value) {
    error.value = t('auth.validation.botToken')
    return
  }

  pendingSubmissionStep.value = 'token'
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
      uiStore.showToast('success', t('auth.success'))
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
        sessionString: `bot_session_${Date.now()}`,
      })
      accountId = newAccount.id
      uiStore.showToast('success', t('auth.success'))
    }

    accountsStore.setActiveAccount(accountId)
    step.value = 'success'

    clearSuccessCloseTimer()
    successCloseTimer = setTimeout(() => {
      handleClose()
      if (props.targetRoute) {
        router.push(props.targetRoute)
      }
    }, 1000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('auth.errors.addBotFailed')
  } finally {
    if (pendingSubmissionStep.value === 'token') {
      pendingSubmissionStep.value = null
    }
  }
}

async function handleClose(): Promise<void> {
  const didAuthenticate = step.value === 'success'
  clearSuccessCloseTimer()
  invalidateUserAuth()
  if (!didAuthenticate) {
    await telegramService.abortCurrentUserAuth()
  }
  emit('close')

  if (didAuthenticate) {
    return
  }
}

function goBack(): void {
  if (isBusy.value) {
    return
  }

  error.value = ''
  if (step.value === 'credentials') {
    // If we have stored creds, go back to choice screen
    if (accountsStore.apiCredentials) {
      step.value = 'credentials-choice'
    }
  } else if (step.value === 'phone') {
    // Go back to credentials or credentials-choice
    if (accountsStore.apiCredentials) {
      step.value = 'credentials-choice'
    } else {
      step.value = 'credentials'
    }
  } else if (step.value === 'code') {
    restartUserAuthFlow()
  } else if (step.value === 'password') {
    restartUserAuthFlow()
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    @click.self="handleClose"
  >
    <div
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="dialogTitleId"
      tabindex="-1"
      @keydown="handleDialogKeydown"
      class="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-5">
        <h2 :id="dialogTitleId" class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ dialogTitle }}
        </h2>
        <button
          ref="closeButtonRef"
          @click="handleClose"
          :aria-label="t('common.close')"
          class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-100"
        >
          ✕
        </button>
      </div>

      <div
        v-if="replacementUserAccount && activeTab === 'user' && step !== 'success'"
        class="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
      >
        <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
          {{ t('auth.reloginAccountTitle', { name: replacementAccountLabel }) }}
        </p>
        <p class="mt-1 text-xs text-amber-800 dark:text-amber-200">
          {{ t('auth.reloginAccountDescription') }}
        </p>
      </div>

      <!-- Tabs -->
      <div
        v-if="canSwitchTabs && step !== 'success'"
        class="flex mb-5 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg"
      >
          <button
            data-testid="tab-user"
            @click="activeTab = 'user'"
            :disabled="isBusy"
            :class="[
              'flex-1 py-2 text-sm font-medium rounded-md transition-all duration-100 disabled:opacity-50',
              activeTab === 'user'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          ]"
        >
          👤 {{ t('accounts.userAccount') }}
        </button>
        <button
          data-testid="tab-bot"
          @click="activeTab = 'bot'"
          :disabled="isBusy"
          :class="[
            'flex-1 py-2 text-sm font-medium rounded-md transition-all duration-100 disabled:opacity-50',
            activeTab === 'bot'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
          ]"
        >
          🤖 {{ t('accounts.botTokenTab') }}
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
              <strong>{{ t('auth.apiCredentials.found') }}</strong>
            </p>
            <p class="text-blue-700 dark:text-blue-400 text-xs">
              {{ t('auth.apiCredentials.foundDescription') }}
            </p>
          </div>

          <div class="space-y-3">
            <!-- Use saved credentials -->
            <button
              @click="useSavedCredentials"
              class="w-full p-3 text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors duration-100"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center text-blue-600"
                >
                  ✓
                </div>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white text-sm">
                    {{ t('auth.apiCredentials.useSaved') }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    API ID: {{ accountsStore.apiCredentials?.apiId }}
                  </p>
                </div>
              </div>
            </button>

            <!-- Enter new credentials -->
            <button
              @click="step = 'credentials'"
              class="w-full p-3 text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-100"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500"
                >
                  +
                </div>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white text-sm">
                    {{ t('auth.apiCredentials.enterNew') }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ t('auth.apiCredentials.enterNewDescription') }}
                  </p>
                </div>
              </div>
            </button>
          </div>
        </template>

        <!-- Step 1: API Credentials -->
        <template v-else-if="step === 'credentials'">
          <button
            v-if="accountsStore.apiCredentials"
            @click="goBack"
            :disabled="isBusy"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-100"
          >
            ← {{ t('accounts.back') }}
          </button>

          <!-- API Explanation -->
          <div
            class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm"
          >
            <p class="text-blue-800 dark:text-blue-300 mb-2">
              <strong>{{ t('auth.apiCredentials.title') }}</strong>
            </p>
            <p class="text-blue-700 dark:text-blue-400 text-xs">
              {{ t('auth.apiCredentials.description') }}
              <a href="https://my.telegram.org/auth" target="_blank" class="underline"
                rel="noopener noreferrer"
                >my.telegram.org</a
              >.
            </p>
          </div>

          <form @submit.prevent="handleCredentialsSubmit" class="space-y-3" :aria-busy="isBusy">
            <div>
              <label
                :for="apiIdInputId"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >{{ t('auth.apiCredentials.apiId') }}</label
              >
              <input
                :id="apiIdInputId"
                ref="apiIdInputRef"
                v-model="apiId"
                type="text"
                inputmode="numeric"
                placeholder="123456"
                spellcheck="false"
                autocomplete="off"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? currentErrorId : undefined"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                required
              />
            </div>
            <div>
              <label
                :for="apiHashInputId"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >{{ t('auth.apiCredentials.apiHash') }}</label
              >
              <input
                :id="apiHashInputId"
                v-model="apiHash"
                type="text"
                placeholder="0123456789abcdef..."
                spellcheck="false"
                autocomplete="off"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? currentErrorId : undefined"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                required
              />
            </div>
            <div
              v-if="error"
              :id="currentErrorId"
              class="text-red-600 text-sm"
              role="alert"
              aria-live="assertive"
            >
              {{ error }}
            </div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
            >
              {{ t('accounts.continue') }}
            </button>
          </form>
        </template>

        <!-- Step 2: Phone -->
        <template v-else-if="step === 'phone'">
          <button
            @click="goBack"
            :disabled="isBusy"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-100"
          >
            ← {{ t('accounts.back') }}
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ t('auth.phone.description') }}
          </p>

          <form @submit.prevent="handlePhoneSubmit" class="space-y-3" :aria-busy="isBusy">
            <div>
              <label
                :for="phoneInputId"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >{{ t('accounts.phoneNumber') }}</label
              >
              <input
                :id="phoneInputId"
                ref="phoneInputRef"
                v-model="phone"
                type="tel"
                :placeholder="t('auth.phone.placeholder')"
                autocomplete="tel"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? currentErrorId : undefined"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                required
              />
            </div>
            <div
              v-if="error"
              :id="currentErrorId"
              class="text-red-600 text-sm"
              role="alert"
              aria-live="assertive"
            >
              {{ error }}
            </div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-100"
              :disabled="isSubmittingPhone"
            >
              {{ isSubmittingPhone ? t('auth.phone.sending') : t('auth.phone.sendCode') }}
            </button>
          </form>
        </template>

        <!-- Step 3: Code -->
        <template v-else-if="step === 'code'">
          <button
            @click="goBack"
            :disabled="isBusy"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-100"
          >
            ← {{ t('accounts.back') }}
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ t('auth.code.description', { phone }) }}
          </p>

          <form @submit.prevent="handleCodeSubmit" class="space-y-3" :aria-busy="isBusy">
            <div>
              <label
                :for="codeInputId"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >{{ t('accounts.verificationCode') }}</label
              >
              <input
                :id="codeInputId"
                ref="codeInputRef"
                v-model="code"
                type="text"
                inputmode="numeric"
                :placeholder="t('auth.code.placeholder')"
                autocomplete="one-time-code"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? currentErrorId : undefined"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center text-xl tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                required
              />
            </div>
            <div
              v-if="error"
              :id="currentErrorId"
              class="text-red-600 text-sm"
              role="alert"
              aria-live="assertive"
            >
              {{ error }}
            </div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-100"
              :disabled="isSubmittingCode || !isCodePromptReady"
            >
              {{ isSubmittingCode ? t('auth.code.verifying') : t('auth.code.verify') }}
            </button>
          </form>
        </template>

        <!-- Step 4: 2FA Password -->
        <template v-else-if="step === 'password'">
          <button
            @click="goBack"
            :disabled="isBusy"
            class="text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors duration-100"
          >
            ← {{ t('accounts.back') }}
          </button>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ t('auth.password.description') }}
          </p>

          <form @submit.prevent="handlePasswordSubmit" class="space-y-3" :aria-busy="isBusy">
            <div>
              <label
                :for="passwordInputId"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >{{ t('accounts.twoFaPassword') }}</label
              >
              <p
                v-if="passwordHint"
                :id="passwordHintId"
                class="text-xs text-gray-500 dark:text-gray-400 mb-1"
              >
                {{ t('accounts.hint') }}: {{ passwordHint }}
              </p>
              <input
                :id="passwordInputId"
                ref="passwordInputRef"
                v-model="password"
                type="password"
                :placeholder="t('auth.password.placeholder')"
                autocomplete="current-password"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="buildDescribedBy(passwordHint ? passwordHintId : undefined, error ? currentErrorId : undefined)"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                required
              />
            </div>
            <div
              v-if="error"
              :id="currentErrorId"
              class="text-red-600 text-sm"
              role="alert"
              aria-live="assertive"
            >
              {{ error }}
            </div>
            <button
              type="submit"
              class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-100"
              :disabled="isSubmittingPassword || !isPasswordPromptReady"
            >
              {{ isSubmittingPassword ? t('auth.password.signingIn') : t('auth.password.signIn') }}
            </button>
          </form>
        </template>
      </template>

      <!-- Bot Token Flow -->
      <template v-if="activeTab === 'bot' && step === 'token'">
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {{ t('auth.bot.description') }}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            class="text-purple-600 hover:underline"
          >
            @BotFather
          </a>
        </p>

        <form @submit.prevent="handleBotTokenSubmit" class="space-y-3" :aria-busy="isBusy">
          <div>
            <label
              :for="botTokenInputId"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >{{ t('accounts.botToken') }}</label
            >
            <div class="relative">
              <input
                :id="botTokenInputId"
                ref="botTokenInputRef"
                :value="botTokenDisplay"
                @input="handleTokenInput"
                @paste="handleTokenPaste"
                type="text"
                :placeholder="t('accounts.pasteTokenHint')"
                spellcheck="false"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                :aria-invalid="error && botToken ? 'true' : undefined"
                :aria-describedby="buildDescribedBy('login-modal-bot-token-help', error ? currentErrorId : undefined)"
                :aria-errormessage="error ? currentErrorId : undefined"
                class="w-full px-3 py-2 pr-10 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-100"
                :class="{
                  'border-green-500 dark:border-green-500': tokenValidated,
                  'border-red-500 dark:border-red-500': error && botToken,
                }"
                required
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
            <p id="login-modal-bot-token-help" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {{ t('accounts.tokenMaskedHint') }}
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
              ⚠️ {{ t('auth.bot.alreadyAdded') }}
            </p>
          </div>

          <div
            v-if="error"
            :id="currentErrorId"
            class="text-red-600 text-sm"
            role="alert"
            aria-live="assertive"
          >
            {{ error }}
          </div>

          <button
            type="submit"
            class="w-full px-4 py-2 rounded-md font-medium text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors duration-100"
            :disabled="isSubmittingBot || !tokenValidated"
          >
            <template v-if="isSubmittingBot">{{
              existingBotAccount ? t('auth.bot.updating') : t('accounts.adding')
            }}</template>
            <template v-else-if="tokenValidated && existingBotAccount"
              >{{ t('auth.bot.update') }}</template
            >
            <template v-else-if="tokenValidated">{{ t('auth.bot.addBot') }}</template>
            <template v-else>{{ t('accounts.enterValidToken') }}</template>
          </button>
        </form>
      </template>

      <!-- Success -->
      <template v-if="step === 'success'">
        <div class="text-center py-6">
          <div class="text-4xl mb-3">✅</div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('auth.success') }}</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('auth.redirecting') }}</p>
        </div>
      </template>

      <!-- Privacy Notice -->
      <div
        v-if="step !== 'success'"
        class="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded text-xs text-gray-500 dark:text-gray-400"
      >
        🔒 {{ t('auth.privacyNote') }}
      </div>
    </div>
  </div>
</template>
