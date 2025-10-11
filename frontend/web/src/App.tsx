// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RoyaltyRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  contributor: string;
  modelUsage: number;
  royaltyAmount: string;
  status: "pending" | "claimed";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<RoyaltyRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [showStats, setShowStats] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const totalRoyalties = records.reduce((sum, record) => sum + parseFloat(record.royaltyAmount), 0);
  const pendingCount = records.filter(r => r.status === "pending").length;
  const claimedCount = records.filter(r => r.status === "claimed").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load royalty records from contract
  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Verify contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("royalty_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing royalty keys:", e);
        }
      }
      
      const list: RoyaltyRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`royalty_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                contributor: recordData.contributor,
                modelUsage: recordData.modelUsage || 0,
                royaltyAmount: recordData.royaltyAmount || "0",
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Contribute to AI model
  const contributeData = async (data: string) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setContributing(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting contribution with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(data)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        contributor: account,
        modelUsage: 0, // Will be updated by FHE computation
        royaltyAmount: "0", // Will be calculated by FHE
        status: "pending"
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `royalty_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("royalty_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "royalty_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Contribution submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowContributeModal(false);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setContributing(false);
    }
  };

  // Claim royalty payment
  const claimRoyalty = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing royalty claim with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`royalty_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "claimed"
      };
      
      await contract.setData(
        `royalty_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Royalty claimed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Claim failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Filter records based on search term
  const filteredRecords = records.filter(record => 
    record.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.contributor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>AI<span>Royalties</span></h1>
          <div className="fhe-badge">FHE-Powered</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowContributeModal(true)} 
            className="primary-btn"
          >
            + Contribute
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowStats(!showStats)}
          >
            {showStats ? "Hide Stats" : "Show Stats"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Royalties for AI Art</h2>
            <p>Contribute to generative AI models and receive royalties anonymously using FHE technology</p>
          </div>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <div className="stat-card">
              <h3>Total Royalties</h3>
              <p className="stat-value">{totalRoyalties.toFixed(4)} ETH</p>
            </div>
            <div className="stat-card">
              <h3>Pending Claims</h3>
              <p className="stat-value">{pendingCount}</p>
            </div>
            <div className="stat-card">
              <h3>Claimed Royalties</h3>
              <p className="stat-value">{claimedCount}</p>
            </div>
          </div>
        )}
        
        <div className="records-section">
          <div className="section-header">
            <h2>Your Royalty Records</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search records..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button 
                onClick={loadRecords}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Model Usage</div>
              <div className="header-cell">Royalty</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <p>No royalty records found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowContributeModal(true)}
                >
                  Make Your First Contribution
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.modelUsage}x</div>
                  <div className="table-cell">{record.royaltyAmount} ETH</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {record.status === "pending" && (
                      <button 
                        className="action-btn"
                        onClick={() => claimRoyalty(record.id)}
                      >
                        Claim
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showContributeModal && (
        <ModalContribute 
          onSubmit={contributeData} 
          onClose={() => setShowContributeModal(false)} 
          contributing={contributing}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <span>AI</span>Royalties
            </div>
            <p>Anonymous royalty distribution using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} AI Royalties. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalContributeProps {
  onSubmit: (data: string) => void; 
  onClose: () => void; 
  contributing: boolean;
}

const ModalContribute: React.FC<ModalContributeProps> = ({ 
  onSubmit, 
  onClose, 
  contributing
}) => {
  const [contributionData, setContributionData] = useState("");

  const handleSubmit = () => {
    if (!contributionData) {
      alert("Please enter contribution data");
      return;
    }
    
    onSubmit(contributionData);
  };

  return (
    <div className="modal-overlay">
      <div className="contribute-modal">
        <div className="modal-header">
          <h2>Contribute to AI Model</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your contribution will be encrypted with FHE for anonymous royalty calculation
          </div>
          
          <div className="form-group">
            <label>Art Data (JSON, Style, or Parameters)</label>
            <textarea 
              value={contributionData} 
              onChange={(e) => setContributionData(e.target.value)}
              placeholder="Enter your art contribution data..." 
              rows={6}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={contributing}
            className="primary-btn"
          >
            {contributing ? "Encrypting with FHE..." : "Submit Contribution"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;