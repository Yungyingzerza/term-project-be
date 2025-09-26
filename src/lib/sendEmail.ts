import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.mail.me.com",
  port: 587, // STARTTLS
  secure: false, // true only for 465
  auth: {
    user: process.env.EMAIL, // usually your @icloud.com Apple ID
    pass: process.env.EMAIL_PASSWORD, // app-specific password
  },
  requireTLS: true,
  // connection hygiene
  pool: true,
  maxConnections: 3,
  maxMessages: 50, // rotate before server gets grumpy
  tls: {
    // leave defaults; don't accept self-signed certs
    minVersion: "TLSv1.2",
  },
});

async function sendEmailNotification(
  subject: string,
  text: string,
  emails: string[]
) {
  // emails is an array of email addresses
  if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD) {
    console.log("No EMAIL or EMAIL_PASSWORD found");
    return;
  }

  //loop through emails and send email to each
  for (const email of emails) {
    const sender = process.env.CUSTOM_EMAIL;

    const mailOptions = {
      from: sender,
      to: email,
      subject,
      text,
      envelope: {
        from: sender,
        to: email,
      },
    };

    // Send the email
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${email}`);
    } catch (error) {
      console.error(`Error sending email to ${email}:`, error);
    }
  }
}

export { sendEmailNotification };
