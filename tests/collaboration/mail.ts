/**
 * Het mailtransport van het framework vervangen door een dat niets verstuurt maar
 * wel onthoudt wat er zou zijn verzonden. Zo raakt een test geen echt adres en
 * blijft hij hetzelfde draaien met of zonder `RESEND_API_KEY` in de omgeving.
 */
export interface VerzondenMail {
  to: string;
  subject: string;
  text?: string;
  html: string;
}

export interface MailTransport {
  /** De mails die het transport zou hebben doorgelaten. */
  verzonden: VerzondenMail[];
  /** Of er een mailtransport ingericht zou zijn. */
  geconfigureerd: boolean;
  /** Als gezet: het transport weigert elke mail met deze fout. */
  fout?: Error;
}

export function mockMailTransport(mail: MailTransport) {
  return {
    isEmailConfigured: async () => mail.geconfigureerd,
    sendEmail: async (args: VerzondenMail) => {
      if (mail.fout) {
        throw mail.fout;
      }
      mail.verzonden.push(args);
    },
  };
}
