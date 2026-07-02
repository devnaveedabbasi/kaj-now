import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const CONTRACT_DIR = 'public/contracts';
const CONTRACT_PATH = `${CONTRACT_DIR}/kajnow_provider_agreement.pdf`;

export const getContractPath = () => CONTRACT_PATH;

export const getContractUrl = (baseUrl) => `${baseUrl}/contracts/kajnow_provider_agreement.pdf`;

export const generateContractPdfIfMissing = () => {
    if (fs.existsSync(CONTRACT_PATH)) return;

    if (!fs.existsSync(CONTRACT_DIR)) {
        fs.mkdirSync(CONTRACT_DIR, { recursive: true });
    }

    const doc = new PDFDocument({ margin: 60 });
    const stream = fs.createWriteStream(CONTRACT_PATH);
    doc.pipe(stream);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('KAJNOW PROVIDER AGREEMENT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').text('Version 1.0  |  Effective Date: 2025', { align: 'center', color: '#666' });
    doc.moveDown(1.5);

    doc.moveTo(60, doc.y).lineTo(550, doc.y).stroke('#ccc');
    doc.moveDown(1);

    const section = (title, body) => {
        doc.fontSize(13).font('Helvetica-Bold').text(title);
        doc.moveDown(0.3);
        doc.fontSize(11).font('Helvetica').text(body, { align: 'justify', lineGap: 4 });
        doc.moveDown(1);
    };

    section(
        '1. Parties',
        'This Provider Agreement ("Agreement") is entered into between KajNow Ltd ("Company") and the individual or company registering as a service provider on the KajNow platform ("Provider").'
    );

    section(
        '2. Services',
        'The Provider agrees to offer services through the KajNow platform in compliance with all applicable laws and regulations in the United Kingdom. The Provider shall maintain all required certifications, licences, and qualifications for the services offered.'
    );

    section(
        '3. Provider Obligations',
        '(a) The Provider must complete all accepted jobs in a professional and timely manner.\n' +
        '(b) The Provider must maintain accurate and up-to-date profile information.\n' +
        '(c) The Provider shall not engage in fraudulent, abusive, or illegal activity.\n' +
        '(d) The Provider must comply with UK consumer protection laws and relevant trade regulations.\n' +
        '(e) The Provider agrees to undergo identity verification as required by the Company.'
    );

    section(
        '4. Fees and Payments',
        'The Company will process payments for completed jobs and transfer the Provider\'s share to their registered wallet after deducting the applicable platform commission. Commission rates are communicated separately and may be updated with 30 days\' notice.'
    );

    section(
        '5. Data Protection',
        'The Provider acknowledges that personal data will be processed in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. The Provider consents to the Company storing and processing their data for the purposes outlined in the Privacy Policy.'
    );

    section(
        '6. Termination',
        'Either party may terminate this Agreement with 14 days\' written notice. The Company reserves the right to immediately suspend or terminate access for breach of this Agreement or applicable laws.'
    );

    section(
        '7. Liability',
        'The Company provides the platform as a marketplace and is not liable for any direct or indirect losses arising from the Provider\'s services. The Provider indemnifies the Company against any claims arising from their services.'
    );

    section(
        '8. Governing Law',
        'This Agreement shall be governed by and construed in accordance with the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.'
    );

    doc.moveDown(1);
    doc.moveTo(60, doc.y).lineTo(550, doc.y).stroke('#ccc');
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').text('PROVIDER ACKNOWLEDGEMENT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').text(
        'By signing below, I confirm that I have read, understood, and agree to be bound by the terms of this KajNow Provider Agreement.',
        { align: 'center', lineGap: 4 }
    );
    doc.moveDown(2);

    doc.fontSize(11).text('Provider Signature:', 60);
    doc.moveDown(0.3);
    doc.rect(60, doc.y, 220, 60).stroke('#999');
    doc.moveDown(5);
    doc.text('Date: _________________________', 60);

    doc.end();

    stream.on('finish', () => {
        console.log('Contract PDF generated at:', CONTRACT_PATH);
    });
};
