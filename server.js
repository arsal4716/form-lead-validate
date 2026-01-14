const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const csv = require("csv-parser");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5009;
mongoose.connect(
  "mongodb+srv://arsalanali124000:LjVqN176LDr4QDhT@cluster0.nmpzmx5.mongodb.net/lead-validate"
);

const validationRecordSchema = new mongoose.Schema({
  cid: { type: String, required: true, index: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: "ValidationResult" },
  jornayaValid: Boolean,
  trustedFormValid: Boolean,
  isValid: Boolean,
  validationMessage: String,
  publisherName: String,

  createdAt: { type: Date, default: Date.now, index: true },
});
validationRecordSchema.index({ cid: 1, createdAt: -1 });

const ValidationRecord = mongoose.model(
  "ValidationRecord",
  validationRecordSchema
);

app.use(cors());
app.use(express.json());
app.use(express.static("uploads"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".csv", ".xlsx", ".xls"];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and Excel files are allowed"));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

const COLUMN_MAPPINGS = {
  CID: ["CID","cid","phoneNumber", "phonenumber", "phoneNo", "phoneno"],
  jornaya: [
    "jornaya",
    "leadidtoken",
    "leadid_token",
    "token",
    "leadid",
    "jornayatoken",
  ],
  trustedForm: [
    "trustedform",
    "tf",
    "certificate",
    "cert_url",
    "certid",
    "trusted_form",
    "certificate_url",
  ],
  phone: ["phone", "phonenumber", "mobile", "telephone"],
  email: ["email", "emailaddress"],
};

const findColumn = (headers, possibleNames) => {
  const headerMap = {};
  headers.forEach((h) => (headerMap[h.toLowerCase().trim()] = h));

  for (const possibleName of possibleNames) {
    if (headerMap[possibleName.toLowerCase()]) {
      return headerMap[possibleName.toLowerCase()];
    }
  }
  return null;
};
const TRUSTEDFORM_CREDENTIALS = {
  apiKey: "d8ad0a7018e52fc200cd0a4b1351a7b6",
};

const extractCertId = (url) => {
  if (!url) return null;
  const match = url.match(/trustedform\.com\/([^/?]+)/);
  return match ? match[1].replace(".html", "") : url;
};

const validateTrustedFormToken = async (certInput) => {
  try {
    const certId = extractCertId(certInput);
    if (!certId) throw new Error("Invalid certificate URL or ID");

    const url = `https://cert.trustedform.com/${certId}/validate`;

    const authHeader =
      "Basic " +
      Buffer.from(`X:${TRUSTEDFORM_CREDENTIALS.apiKey}`).toString("base64");

    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
    });
    return {
      valid: response.data.outcome === "success",
      outcome: response.data.outcome,
      reason: response.data.reason,
      message:
        response.data.outcome === "success"
          ? "Valid TrustedForm certificate"
          : response.data.reason || "Invalid certificate",
    };
  } catch (error) {
    if (error.response) {
      console.error("Response Status:", error.response.status);
      console.error("Response Data:", error.response.data);

      if (error.response.status === 401) {
        return {
          valid: false,
          message: "Authentication failed — check API key or permissions.",
        };
      }

      if (error.response.status === 404) {
        return { valid: false, message: "Certificate not found." };
      }
    }

    return {
      valid: false,
      message:
        error.response?.data?.message ||
        "Error validating TrustedForm certificate.",
    };
  }
};

const validateJornayaToken = async (
  tokenId,
  lac = "675C7AD0-766C-086F-2192-FC4BF16CACF6"
) => {
  try {
    const response = await axios.get(
      `https://api.leadid.com/Authenticate?lac=${lac}&id=${tokenId}`,
      { headers: { Accept: "application/json" } }
    );

    let data =
      typeof response.data === "string"
        ? JSON.parse(response.data)
        : response.data;

    if (data.authenticate) {
      const authentic = Number(data.authenticate.authentic);
      return {
        valid: authentic === 1,
        token: data.authenticate.token,
        transid: data.transid,
        message: authentic === 1 ? "Valid token" : "Invalid token",
      };
    }

    return { valid: false, message: "Invalid response format from Jornaya" };
  } catch (error) {
    console.error("Jornaya validation error:", error.message);
    return {
      valid: false,
      message:
        error.response?.data?.message || "Error validating Jornaya token",
    };
  }
};
const processCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
};
const processExcel = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  } catch (error) {
    throw new Error(`Error reading Excel file: ${error.message}`);
  }
};
// single lead validate
app.post("/api/validate-lead", async (req, res) => {
  try {
    const {
      cid,
      jornayaToken,
      trustedFormToken,
      serviceType = "both",
      publisherName,
      saveToDB = true,
    } = req.body;

    if (!cid) {
      return res.status(400).json({ error: "CID is required" });
    }

    let jornayaResult = null;
    let trustedFormResult = null;
    let isValid = false;
    let validationMessage = "";

    if (serviceType === "jornaya" || serviceType === "both") {
      if (jornayaToken) {
        jornayaResult = await validateJornayaToken(jornayaToken);
      }
    }

    if (serviceType === "trustedform" || serviceType === "both") {
      if (trustedFormToken) {
        trustedFormResult = await validateTrustedFormToken(trustedFormToken);
      }
    }

    if (serviceType === "jornaya") {
      isValid = jornayaResult?.valid || false;
      validationMessage = jornayaResult?.message || "No Jornaya token provided";
    } else if (serviceType === "trustedform") {
      isValid = trustedFormResult?.valid || false;
      validationMessage =
        trustedFormResult?.message || "No TrustedForm token provided";
    } else {
      const jornayaValid = jornayaResult?.valid || false;
      const trustedFormValid = trustedFormResult?.valid || false;
      isValid = jornayaValid && trustedFormValid;
      validationMessage = `Jornaya: ${
        jornayaValid ? "Valid" : "Invalid"
      }, TrustedForm: ${trustedFormValid ? "Valid" : "Invalid"}`;
    }

    const result = {
      cid: String(cid).trim(),
      publisherName,
      jornayaToken,
      trustedFormToken,
      jornayaValid: jornayaResult?.valid || false,
      trustedFormValid: trustedFormResult?.valid || false,
      validationMessage,
      timestamp: new Date(),
    };

    if (saveToDB) {
      await ValidationRecord.create({
        cid: result.cid,
        publisherName,
        jornayaValid: result.jornayaValid,
        trustedFormValid: result.trustedFormValid,
        validationMessage,
        createdAt: result.timestamp,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Single lead validation error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// file checking
app.post("/api/validate-tokens", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!req.body.serviceType) {
      return res.status(400).json({ error: "Service type is required" });
    }
    const { publisherName } = req.body;

    const serviceType = req.body.serviceType;
    const shouldSaveToDB = req.body.saveToDB === "true";
    let tokens = [];

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt === ".csv") {
      tokens = await processCSV(req.file.path);
    } else if (fileExt === ".xlsx" || fileExt === ".xls") {
      tokens = await processExcel(req.file.path);
    } else {
      return res.status(400).json({ error: "Unsupported file format" });
    }

    if (!tokens.length) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "No records found in file" });
    }
    const headers = Object.keys(tokens[0]);
    const cidColumn = findColumn(headers, COLUMN_MAPPINGS.CID);
    const jornayaColumn = findColumn(headers, COLUMN_MAPPINGS.jornaya);
    const trustedFormColumn = findColumn(headers, COLUMN_MAPPINGS.trustedForm);

    if (!cidColumn) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "CID column not found in file" });
    }

    if (serviceType === "jornaya" && !jornayaColumn) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: "Jornaya token column not found",
        availableColumns: headers,
        expectedNames: COLUMN_MAPPINGS.jornaya,
      });
    }

    if (serviceType === "trustedform" && !trustedFormColumn) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: "TrustedForm certificate column not found",
        availableColumns: headers,
        expectedNames: COLUMN_MAPPINGS.trustedForm,
      });
    }

    const validationResults = [];
    const batchSize = 5;
    let batchPromises = [];

    for (const [index, row] of tokens.entries()) {
      const cid = row[cidColumn] || `ROW_${index + 1}`;
      const jornayaToken =
        serviceType !== "trustedform" ? row[jornayaColumn] : null;
      const trustedFormToken =
        serviceType !== "jornaya" ? row[trustedFormColumn] : null;

      const validationPromise = (async () => {
        let jornayaResult = null;
        let trustedFormResult = null;
        let isValid = false;
        let validationMessage = "";

        try {
          if (serviceType === "jornaya" || serviceType === "both") {
            if (jornayaToken) {
              jornayaResult = await validateJornayaToken(jornayaToken);
            }
          }

          if (serviceType === "trustedform" || serviceType === "both") {
            if (trustedFormToken) {
              trustedFormResult = await validateTrustedFormToken(
                trustedFormToken
              );
            }
          }
          if (serviceType === "jornaya") {
            isValid = jornayaResult?.valid || false;
            validationMessage =
              jornayaResult?.message || "No Jornaya token provided";
          } else if (serviceType === "trustedform") {
            isValid = trustedFormResult?.valid || false;
            validationMessage =
              trustedFormResult?.message || "No TrustedForm token provided";
          } else if (serviceType === "both") {
            const jornayaValid = jornayaResult?.valid || false;
            const trustedFormValid = trustedFormResult?.valid || false;
            isValid = jornayaValid && trustedFormValid;
            validationMessage = `Jornaya: ${
              jornayaValid ? "Valid" : "Invalid"
            }, TrustedForm: ${trustedFormValid ? "Valid" : "Invalid"}`;
          }

          return {
            CID: cid,
            originalRow: row,
            jornayaToken,
            trustedFormToken,
            jornayaValid: jornayaResult?.valid || false,
            trustedFormValid: trustedFormResult?.valid || false,
            jornayaResponse: jornayaResult,
            trustedFormResponse: trustedFormResult,
            publisherName: publisherName,
            isValid,
            validationMessage,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            CID: cid,
            originalRow: row,
            jornayaToken,
            trustedFormToken,
            isValid: false,
            validationMessage: `Validation error: ${error.message}`,
            timestamp: new Date().toISOString(),
          };
        }
      })();

      batchPromises.push(validationPromise);
      if (batchPromises.length >= batchSize || index === tokens.length - 1) {
        const batchResults = await Promise.all(batchPromises);
        validationResults.push(...batchResults);
        batchPromises = [];
        if (index < tokens.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    fs.unlinkSync(req.file.path);
    const validResults = validationResults.filter((r) => r.isValid);
    const invalidResults = validationResults.filter((r) => !r.isValid);
    let savedResult = null;
    if (shouldSaveToDB) {
      const resultData = {
        filename: req.file.originalname,
        serviceType,
        totalRecords: validationResults.length,
        validCount: validResults.length,
        invalidCount: invalidResults.length,
        results: validationResults.map((r) => ({
          CID: r.CID,
          jornayaToken: r.jornayaToken,
          trustedFormToken: r.trustedFormToken,
          jornayaValid: r.jornayaValid,
          trustedFormValid: r.trustedFormValid,
          jornayaResponse: r.jornayaResponse,
          trustedFormResponse: r.trustedFormResponse,
          publisherName: r.publisherName,
          isValid: r.isValid,
          validationMessage: r.validationMessage,
          timestamp: r.timestamp,
        })),
      };

      await ValidationRecord.insertMany(
        validationResults
          .filter((r) => r.CID && r.CID.trim() !== "")
          .map((r) => ({
            cid: String(r.CID).trim(),
            userId: req.user?._id,
            jornayaValid: r.jornayaValid,
            trustedFormValid: r.trustedFormValid,
            isValid: r.isValid,
            publisherName: r.publisherName,
            validationMessage: r.validationMessage,
            createdAt: new Date(r.timestamp),
          }))
      );
    }
    const response = {
      success: true,
      summary: {
        filename: req.file.originalname,
        serviceType,
        totalRecords: validationResults.length,
        validRecords: validResults.length,
        invalidRecords: invalidResults.length,
        validationRate:
          ((validResults.length / validationResults.length) * 100).toFixed(2) +
          "%",
        savedToDB: shouldSaveToDB,
        resultId: savedResult?._id,
      },
      results: validationResults,
      columnMapping: {
        CID: cidColumn,
        jornaya: jornayaColumn,
        trustedForm: trustedFormColumn,
      },
    };
    res.json(response);
  } catch (error) {
    console.error("Validation error:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: "Internal server error",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});
app.get("/api/validation-result/:cid", async (req, res) => {
  try {
    const record = await ValidationRecord.findOne(
      { cid: req.params.cid },
      {},
      { sort: { createdAt: -1 } }
    );

    if (!record) {
      return res.status(404).json({ error: "CID not found" });
    }

    res.json({
      CID: record.cid,
      jornayaValid: record.jornayaValid,
      trustedFormValid: record.trustedFormValid,
      isValid: record.isValid,
      publisherName: record.publisherName,
      validationMessage: record.validationMessage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/download-results", express.json(), (req, res) => {
  try {
    const { results, format = "csv", filter = "all" } = req.body;

    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "No results data provided" });
    }

    // Filter results
    let dataToExport = results;
    if (filter === "valid") dataToExport = dataToExport.filter(r => r.isValid);
    if (filter === "invalid") dataToExport = dataToExport.filter(r => !r.isValid);

    if (!dataToExport.length)
      return res.status(400).json({ error: "No data to export after filtering" });

    const fileName = `validation-results-${filter}-${Date.now()}`;

    const flattenedResults = dataToExport.map(result => ({
      ...result.originalRow,
      _Jornaya_Token: result.jornayaToken || "",
      _TrustedForm_Token: result.trustedFormToken || "",
      _Jornaya_Valid: result.jornayaValid ? "Yes" : "No",
      _TrustedForm_Valid: result.trustedFormValid ? "Yes" : "No",
      _Overall_Valid: result.isValid ? "Yes" : "No",
      _Validation_Message: result.validationMessage || "",
      _Timestamp: result.timestamp || new Date().toISOString(),
    }));

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}.csv"`);

      const headers = Object.keys(flattenedResults[0]);
      res.write(headers.join(",") + "\n");

      for (const row of flattenedResults) {
        const rowStr = headers
          .map(h => `"${String(row[h] ?? "").replace(/"/g, '""')}"`)
          .join(",");
        res.write(rowStr + "\n");
      }
      return res.end();
    }

    if (format === "excel") {
      const worksheet = XLSX.utils.json_to_sheet(flattenedResults);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Validation Results");

      const maxColWidths = Object.keys(flattenedResults[0]).map(key =>
        Math.max(key.length, ...flattenedResults.map(r => String(r[key] ?? "").length))
      );
      worksheet["!cols"] = maxColWidths.map(w => ({ wch: w + 5 }));

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}.xlsx"`);
      return res.send(buffer);
    }

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}.json"`);
      return res.send(JSON.stringify(flattenedResults, null, 2));
    }

    return res.status(400).json({ error: "Unsupported format" });
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Error generating download file" });
  }
});

// if (process.env.NODE_ENV === "production") {
app.use(express.static(path.join(__dirname, "frontend/build")));
app.get(/^\/(?!api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "frontend/build", "index.html"));
});
// }
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File too large. Maximum size is 10MB" });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
