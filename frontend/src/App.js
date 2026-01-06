import React, { useState, useEffect } from "react";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Spinner,
  Table,
  Alert,
  ProgressBar,
  Navbar,
  Nav,
  Modal,
  Tabs,
  Tab,
  Badge,
} from "react-bootstrap";
import { saveAs } from "file-saver";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://72.60.233.42:5009/api";

const App = () => {
  const [file, setFile] = useState(null);
  const [serviceType, setServiceType] = useState("both");
  const [saveToDB, setSaveToDB] = useState(true);
  const [loading, setLoading] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  const [downloadFilter, setDownloadFilter] = useState("all");
  const [downloadFormat, setDownloadFormat] = useState("csv");
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState("validate");
  const [publisherName, setpublisherName] = useState("");

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const validTypes = [".csv", ".xlsx", ".xls"];
      const fileExt = selectedFile.name
        .toLowerCase()
        .slice(selectedFile.name.lastIndexOf("."));

      if (!validTypes.includes(fileExt)) {
        toast.error("Please select a CSV or Excel file");
        e.target.value = "";
        return;
      }

      if (selectedFile.size > 100 * 1024 * 1024) {
        toast.error("File size must be less than 100MB");
        e.target.value = "";
        return;
      }

      setFile(selectedFile);
      toast.info(`Selected file: ${selectedFile.name}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file) {
      toast.error("Please select a file");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("publisherName", publisherName);
    formData.append("serviceType", serviceType);
    formData.append("saveToDB", saveToDB.toString());

    setLoading(true);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/validate-tokens`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
          },
        }
      );

      setValidationResults(response.data);
      toast.success(
        `Validation completed! ${response.data.summary.validRecords} valid, ${response.data.summary.invalidRecords} invalid`
      );
    } catch (error) {
      console.error("Validation error:", error);
      toast.error(error.response?.data?.error || "Validation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (
    filter = downloadFilter,
    format = downloadFormat
  ) => {
    if (!validationResults) {
      toast.error("No validation results to download");
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/download-results`,
        {
          results: validationResults.results,
          filter,
          format,
          resultId: validationResults.summary.resultId,
        },
        {
          responseType: "blob",
        }
      );

      const extension =
        format === "excel" ? "xlsx" : format === "json" ? "json" : "csv";
      const filename = `validation-results-${filter}-${Date.now()}.${extension}`;

      saveAs(response.data, filename);
      toast.success("Download started!");
    } catch (error) {
      toast.error("Download failed");
    }
  };

  const handleDownloadAllFormats = () => {
    handleDownload("all", "csv");
    setTimeout(() => handleDownload("valid", "csv"), 100);
    setTimeout(() => handleDownload("invalid", "csv"), 200);
  };

  const getStatusBadge = (isValid) => {
    return (
      <Badge bg={isValid ? "success" : "danger"}>
        {isValid ? "Valid" : "Invalid"}
      </Badge>
    );
  };

  const renderResultsTable = () => {
    if (!validationResults?.results) return null;

    const resultsToShow = validationResults.results.slice(0, 50);
    return (
      <div className="mt-4">
        <Card>
          <Card.Header>
            <h5>Validation Results (First 50 rows)</h5>
            <div className="d-flex justify-content-between align-items-center">
              <small>Total: {validationResults.results.length} rows</small>
              <div>
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => setActiveTab("detailed")}
                >
                  View Details
                </Button>
              </div>
            </div>
          </Card.Header>
          <Card.Body style={{ maxHeight: "500px", overflow: "auto" }}>
            <Table striped bordered hover responsive>
              <thead>
                <tr>
                  <th>CID</th>
                  <th>Jornaya Valid</th>
                  <th>TrustedForm Valid</th>
                  <th>Overall Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {resultsToShow.map((result, index) => (
                  <tr key={index}>
                    <td>{result.CID}</td>
                    <td>
                      {result.jornayaValid !== undefined
                        ? getStatusBadge(result.jornayaValid)
                        : "N/A"}
                    </td>
                    <td>
                      {result.trustedFormValid !== undefined
                        ? getStatusBadge(result.trustedFormValid)
                        : "N/A"}
                    </td>
                    <td>{getStatusBadge(result.isValid)}</td>
                    <td>
                      <small className="text-muted">
                        {result.validationMessage}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {validationResults.results.length > 50 && (
              <Alert variant="info">
                Showing first 50 of {validationResults.results.length} rows. Use
                download to see all results.
              </Alert>
            )}
          </Card.Body>
        </Card>
      </div>
    );
  };

  const renderDashboard = () => {
    if (!stats) return null;

    return (
      <div className="mt-4">
        <Row>
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <Card.Title>{stats.stats.totalValidations}</Card.Title>
                <Card.Text>Total Validations</Card.Text>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <Card.Title>{stats.stats.totalRecords}</Card.Title>
                <Card.Text>Total Records</Card.Text>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <Card.Title>{stats.stats.totalValid}</Card.Title>
                <Card.Text>Valid Records</Card.Text>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <Card.Title>
                  {stats.stats.overallValidationRate.toFixed(2)}%
                </Card.Title>
                <Card.Text>Success Rate</Card.Text>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card className="mt-4">
          <Card.Header>
            <h5>Recent Validations</h5>
          </Card.Header>
          <Card.Body>
            <Table striped hover>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Service Type</th>
                  <th>Records</th>
                  <th>Valid</th>
                  <th>Invalid</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentValidations.map((item, index) => (
                  <tr key={index}>
                    <td>
                      <small>{item.filename}</small>
                    </td>
                    <td>
                      <Badge bg="info">{item.serviceType}</Badge>
                    </td>
                    <td>{item.totalRecords}</td>
                    <td className="text-success">{item.validCount}</td>
                    <td className="text-danger">{item.invalidCount}</td>
                    <td>
                      <small>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </div>
    );
  };
  return (
    <div>
      <Navbar bg="dark" variant="dark" expand="lg">
        <Container>
          <Navbar.Brand href="#">
            <i className="bi bi-shield-check me-2"></i>
            Token Validator Pro
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="navbar-nav" />
          <Navbar.Collapse id="navbar-nav">
            <Nav className="me-auto">
              <Nav.Link
                active={activeTab === "validate"}
                onClick={() => setActiveTab("validate")}
              >
                Validate Tokens
              </Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container className="mt-4">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-3"
        >
          <Tab eventKey="validate" title="Validate Tokens">
            <Card>
              <Card.Header>
                <h4>Upload & Validate Tokens</h4>
                <p className="text-muted mb-0">
                  Upload CSV/Excel file containing CID, Jornaya, and TrustedForm
                  tokens
                </p>
              </Card.Header>
              <Card.Body>
                <Form onSubmit={handleSubmit}>
                  <Row>
                    <Col md={12}>
                      <Form.Group className="mb-3">
                        <Form.Label>
                          Please Enter Valid Publisher Name
                        </Form.Label>
                        <Form.Control
                          type="text"
                          name="publisherName"
                          value={publisherName}
                          onChange={(e) => setpublisherName(e.target.value)}
                          required
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Select File (CSV or Excel)</Form.Label>
                        <Form.Control
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          onChange={handleFileChange}
                          required
                        />
                        <Form.Text className="text-muted">
                          Maximum file size: 10MB. Supported columns: "cid",
                          "phoneNumber",phonenumber, "phoneNo", "phoneno",
                          "leadid", "jornaya", "leadidtoken", "leadid_token",
                          "token", "leadid", "jornayatoken","trustedform", "tf",
                          "certificate", "cert_url", "certid", "trusted_form",
                          "certificate_url",
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>Service Type</Form.Label>
                        <div>
                          <Form.Check
                            inline
                            type="radio"
                            label="Jornaya Only"
                            name="serviceType"
                            value="jornaya"
                            checked={serviceType === "jornaya"}
                            onChange={(e) => setServiceType(e.target.value)}
                          />
                          <Form.Check
                            inline
                            type="radio"
                            label="TrustedForm Only"
                            name="serviceType"
                            value="trustedform"
                            checked={serviceType === "trustedform"}
                            onChange={(e) => setServiceType(e.target.value)}
                          />
                          <Form.Check
                            inline
                            type="radio"
                            label="Both"
                            name="serviceType"
                            value="both"
                            checked={serviceType === "both"}
                            onChange={(e) => setServiceType(e.target.value)}
                          />
                        </div>
                      </Form.Group>
                    </Col>
                  </Row>

                  <Form.Group className="mb-3">
                    <Form.Check
                      type="checkbox"
                      label="I Agree to Proceed"
                      checked={saveToDB}
                      required
                      onChange={(e) => setSaveToDB(e.target.checked)}
                    />
                  </Form.Group>

                  <Button
                    variant="primary"
                    type="submit"
                    disabled={loading || !file}
                    className="me-2"
                  >
                    {loading ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          className="me-2"
                        />
                        Validating...
                      </>
                    ) : (
                      "Start Validation"
                    )}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFile(null);
                      setValidationResults(null);
                    }}
                  >
                    Clear
                  </Button>
                </Form>

                {validationResults && (
                  <div className="mt-4">
                    <Alert variant="success">
                      <h5>Validation Complete!</h5>
                      <p>
                        File:{" "}
                        <strong>{validationResults.summary.filename}</strong>
                        <br />
                        Total Records:{" "}
                        <strong>
                          {validationResults.summary.totalRecords}
                        </strong>
                        <br />
                        Valid Records:{" "}
                        <strong className="text-success">
                          {validationResults.summary.validRecords}
                        </strong>
                        <br />
                        Invalid Records:{" "}
                        <strong className="text-danger">
                          {validationResults.summary.invalidRecords}
                        </strong>
                        <br />
                        Validation Rate:{" "}
                        <strong>
                          {validationResults.summary.validationRate}
                        </strong>
                      </p>
                    </Alert>

                    <Card className="mb-4">
                      <Card.Header>
                        <h5>Download Results</h5>
                      </Card.Header>
                      <Card.Body>
                        <Row>
                          <Col md={4}>
                            <Form.Group className="mb-3">
                              <Form.Label>Filter</Form.Label>
                              <Form.Select
                                value={downloadFilter}
                                onChange={(e) =>
                                  setDownloadFilter(e.target.value)
                                }
                              >
                                <option value="all">All Results</option>
                                <option value="valid">Valid Only</option>
                                <option value="invalid">Invalid Only</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group className="mb-3">
                              <Form.Label>Format</Form.Label>
                              <Form.Select
                                value={downloadFormat}
                                onChange={(e) =>
                                  setDownloadFormat(e.target.value)
                                }
                              >
                                <option value="csv">CSV</option>
                                <option value="excel">Excel</option>
                                <option value="json">JSON</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                          <Col md={4} className="d-flex align-items-end">
                            <Button
                              variant="success"
                              onClick={() => handleDownload()}
                              className="me-2"
                            >
                              <i className="bi bi-download me-1"></i>
                              Download
                            </Button>
                            <Button
                              variant="outline-primary"
                              onClick={handleDownloadAllFormats}
                              title="Download all formats"
                            >
                              <i className="bi bi-download-all"></i>
                              Download all formats
                            </Button>
                          </Col>
                        </Row>
                      </Card.Body>
                    </Card>

                    {renderResultsTable()}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Tab>
        </Tabs>
      </Container>

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default App;
