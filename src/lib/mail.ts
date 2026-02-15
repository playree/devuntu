import { t } from '@/locale/server'
import sgMail from '@sendgrid/mail'
import { createTransport } from 'nodemailer'
import { envu } from './env-util'
import { errSystemError } from './error'
import { logger } from './logger'

type SendEmail = {
  to: string | { name: string; email: string; address: string }
  from: string | { name: string; email: string; address: string }
  subject: string
  text: string
}

/**
 * SendGrid
 * @param param
 */
const sendGrid = async (param: SendEmail) => {
  sgMail.setApiKey(envu.server.SENDGRID_API_KEY)
  await sgMail.send(param)
}

/**
 * sendmailコマンド
 * @param param
 */
const sendMail = async (param: SendEmail) => {
  const tp = createTransport({
    sendmail: true,
    newline: 'unix',
    path: envu.server.SENDMAIL_PATH,
  })
  await tp.sendMail(param)
}

/**
 * SMTP
 * @param param
 */
const sendSmtp = async (param: SendEmail) => {
  const user = envu.server.SMTP_USER
  const pass = envu.server.SMTP_PASS

  const tp = createTransport({
    host: envu.server.SMTP_HOST,
    port: envu.server.SMTP_PORT,
    ignoreTLS: envu.server.SMTP_IGNORE_TLS,
    secure: envu.server.SMTP_SECURE,
    auth:
      user && pass
        ? {
            user,
            pass,
          }
        : undefined,
  })
  await tp.sendMail(param)
}

const sendEmail = async (param: Omit<SendEmail, 'from'>) => {
  const mailFrom = envu.server.MAIL_FROM

  const from = {
    name: envu.server.NEXT_PUBLIC_APP_NAME,
    email: mailFrom,
    address: mailFrom,
  }
  switch (envu.server.MAIL_SEND) {
    case 'sendgrid':
      return sendGrid({
        from,
        ...param,
      })
    case 'sendmail':
      return sendMail({
        from,
        ...param,
      })
    case 'smtp':
      return sendSmtp({
        from,
        ...param,
      })
    case 'debug':
      logger.info({ param, from }, 'sendEmail debug')
      return
  }
  throw errSystemError('Unable to send email')
}

export const sendEmailOtp = async (param: { locale?: string; to: string; otp: string }) => {
  const { locale = '', to, otp } = param
  const { hostname } = new URL(envu.server.NEXT_PUBLIC_URL)

  logger.info({ to }, 'sendEmailOtp')
  await sendEmail({
    to,
    subject: t(locale, 'mail_otp_subject', { appname: envu.server.NEXT_PUBLIC_APP_NAME, otp }),
    text: t(locale, 'mail_otp_body', { otp, hostname }),
  })
}
