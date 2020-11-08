"""
Programmer: Chris Tralie, 12/2016 (ctralie@alumni.princeton.edu)
Purpose: To implement similarity network fusion approach described in
[1] Wang, Bo, et al. "Unsupervised metric fusion by cross diffusion." Computer Vision and Pattern Recognition (CVPR), 2012 IEEE Conference on. IEEE, 2012.
[2] Wang, Bo, et al. "Similarity network fusion for aggregating data types on a genomic scale." Nature methods 11.3 (2014): 333-337.
[3] Tralie, Christopher et. al. "Enhanced Hierarchical Music Structure Annotations via Feature Level Similarity Fusion." ICASSP 2019
"""
import numpy as np
import matplotlib.pyplot as plt
from scipy import sparse
import scipy.io as sio
import time
import os
import librosa
import subprocess
from CSMSSMTools import *

def getW(D, K, Mu = 0.5):
    """
    Return affinity matrix
    :param D: Self-similarity matrix
    :param K: Number of nearest neighbors
    :param Mu: Nearest neighbor hyperparameter (default 0.5)
    """
    #W(i, j) = exp(-Dij^2/(mu*epsij))
    DSym = 0.5*(D + D.T)
    np.fill_diagonal(DSym, 0)

    Neighbs = np.partition(DSym, K+1, 1)[:, 0:K+1]
    MeanDist = np.mean(Neighbs, 1)*float(K+1)/float(K) #Need this scaling
    #to exclude diagonal element in mean
    #Equation 1 in SNF paper [2] for estimating local neighborhood radii
    #by looking at k nearest neighbors, not including point itself
    Eps = MeanDist[:, None] + MeanDist[None, :] + DSym
    Eps = Eps/3
    Denom = (2*(Mu*Eps)**2)
    Denom[Denom == 0] = 1
    W = np.exp(-DSym**2/Denom)
    return W

def getP(W, diagRegularize = False):
    """
    Turn a similarity matrix into a proability matrix,
    with each row sum normalized to 1
    :param W: (MxM) Similarity matrix
    :param diagRegularize: Whether or not to regularize
    the diagonal of this matrix
    :returns P: (MxM) Probability matrix
    """
    if diagRegularize:
        P = 0.5*np.eye(W.shape[0])
        WNoDiag = np.array(W)
        np.fill_diagonal(WNoDiag, 0)
        RowSum = np.sum(WNoDiag, 1)
        RowSum[RowSum == 0] = 1
        P = P + 0.5*WNoDiag/RowSum[:, None]
        return P
    else:
        RowSum = np.sum(W, 1)
        RowSum[RowSum == 0] = 1
        P = W/RowSum[:, None]
        return P

def getS(W, K):
    """
    Same thing as P but restricted to K nearest neighbors
        only (using partitions for fast nearest neighbor sets)
    (**note that nearest neighbors here include the element itself)
    :param W: (MxM) similarity matrix
    :param K: Number of neighbors to use per row
    :returns S: (MxM) S matrix
    """
    N = W.shape[0]
    J = np.argpartition(-W, K, 1)[:, 0:K]
    I = np.tile(np.arange(N)[:, None], (1, K))
    V = W[I.flatten(), J.flatten()]
    #Now figure out L1 norm of each row
    V = np.reshape(V, J.shape)
    SNorm = np.sum(V, 1)
    SNorm[SNorm == 0] = 1
    V = V/SNorm[:, None]
    [I, J, V] = [I.flatten(), J.flatten(), V.flatten()]
    S = sparse.coo_matrix((V, (I, J)), shape=(N, N)).tocsr()
    return S


def doSimilarityFusionWs(Ws, K = 5, niters = 20, reg_diag = 1, reg_neighbs = 0.5, \
        do_animation = False, PlotNames = [], PlotExtents = None, verboseTimes = True):
    """
    Perform similarity fusion between a set of exponentially
    weighted similarity matrices
    :param Ws: An array of NxN affinity matrices for N songs
    :param K: Number of nearest neighbors
    :param niters: Number of iterations
    :param reg_diag: Identity matrix regularization parameter for
        self-similarity promotion
    :param reg_neighbs: Neighbor regularization parameter for promoting
        adjacencies in time
    :param do_animation: Save an animation of the cross-diffusion process
    :param PlotNames: Strings describing different similarity
        measurements for the animation
    :param PlotExtents: Time labels for images
    :return D: A fused NxN similarity matrix
    """
    tic = time.time()
    #Full probability matrices
    Ps = [getP(W) for W in Ws]
    #Nearest neighbor truncated matrices
    Ss = [getS(W, K) for W in Ws]

    #Now do cross-diffusion iterations
    Pts = [np.array(P) for P in Ps]
    nextPts = [np.zeros(P.shape) for P in Pts]
    if verboseTimes:
        print("Time getting Ss and Ps: %g"%(time.time() - tic))

    N = len(Pts)
    AllTimes = []
    if do_animation:
        res = 5
        plt.figure(figsize=(res*N, res*2))
    for it in range(niters):
        ticiter = time.time()
        if do_animation:
            for i in range(N):
                plt.subplot(1, N, i+1)
                Im = 1.0*Pts[i]
                np.fill_diagonal(Im, 0)
                if PlotExtents:
                    plt.imshow(np.log(5e-2+Im), interpolation = 'none', cmap = 'afmhot', \
                    extent = (PlotExtents[0], PlotExtents[1], PlotExtents[1], PlotExtents[0]))
                    plt.xlabel("Time (sec)")
                    plt.ylabel("Time (sec)")
                else:
                    plt.imshow(np.log(5e-2+Im), interpolation = 'none', cmap = 'afmhot')
                plt.title(PlotNames[i])
            plt.savefig("SSMFusion%i.png"%it, dpi=300, bbox_inches='tight')
            plt.clf()
        for i in range(N):
            nextPts[i] *= 0
            tic = time.time()
            for k in range(N):
                if i == k:
                    continue
                nextPts[i] += Pts[k]
            nextPts[i] /= float(N-1)

            #Need S*P*S^T, but have to multiply sparse matrix on the left
            tic = time.time()
            A = Ss[i].dot(nextPts[i].T)
            nextPts[i] = Ss[i].dot(A.T)
            toc = time.time()
            AllTimes.append(toc - tic)
            if reg_diag > 0:
                nextPts[i] += reg_diag*np.eye(nextPts[i].shape[0])
            if reg_neighbs > 0:
                arr = np.arange(nextPts[i].shape[0])
                [I, J] = np.meshgrid(arr, arr)
                #Add diagonal regularization as well
                nextPts[i][np.abs(I - J) == 1] += reg_neighbs

        Pts = nextPts
        if verboseTimes:
            print("Elapsed Time Iter %i of %i: %g"%(it+1, niters, time.time()-ticiter))
    if verboseTimes:
        print("Total Time multiplying: %g"%np.sum(np.array(AllTimes)))
    FusedScores = np.zeros(Pts[0].shape)
    for Pt in Pts:
        FusedScores += Pt
    return FusedScores/N

def doSimilarityFusion(Scores, K = 5, niters = 20, reg_diag = 1, \
        reg_neighbs = 0.5, do_animation = False, PlotNames = [], PlotExtents = None):
    """
    Do similarity fusion on a set of NxN distance matrices.
    Parameters the same as doSimilarityFusionWs
    :returns (An array of similarity matrices for each feature, Fused Similarity Matrix)
    """
    #Affinity matrices
    Ws = [getW(D, K) for D in Scores]
    return (Ws, doSimilarityFusionWs(Ws, K, niters, reg_diag, reg_neighbs, \
                    do_animation, PlotNames, PlotExtents))


def plotFusionResults(Ws, vs, alllabels, times, win_fac, intervals_hier = [], labels_hier = []):
    """
    Show a plot of different adjacency matrices and their associated eigenvectors
    and cluster labels, if applicable
    Parameters
    ----------
    Ws: Dictionary of string:ndarray(N, N)
        Different adjacency matrix types
    vs: Dictionary of string:ndarray(N, k)
        Laplacian eigenvectors for different adjacency matrix types.
        If there is not a key for a particular adjacency matrix type, it isn't plotted
    alllabels: Dictionary of string:ndarray(N)
        Labels from spectral clustering for different adjacency matrix types.
        If there is not a key for a particular adjacency matrix type, it isn't plotted
    times: ndarray(N)
        A list of times corresponding to each row in Ws
    win_fac: int
        Number of frames that have been averaged in each window
        If negative, beat tracking has been done, and the intervals are possibly non-uniform
        This means that a mesh plot will be necessary
    Returns
    -------
    fig: matplotlib.pyplot object
        Handle to the figure
    """
    nrows = int(np.ceil(len(Ws)/3.0))
    fac = 0.7
    fig = plt.figure(figsize=(fac*32, fac*8*nrows))
    time_uniform = win_fac >= 0
    for i, name in enumerate(Ws):
        W = Ws[name]
        floor = np.quantile(W.flatten(), 0.01)
        WShow = np.log(W+floor)
        np.fill_diagonal(WShow, 0)
        row, col = np.unravel_index(i, (nrows, 3))
        plt.subplot2grid((nrows, 8*3), (row, col*8), colspan=7)
        if time_uniform:
            plt.imshow(WShow, cmap ='magma_r', extent=(times[0], times[-1], times[-1], times[0]), interpolation='nearest')
        else:
            plt.pcolormesh(times, times, WShow, cmap = 'magma_r')
            plt.gca().invert_yaxis()
        plt.title("%s Similarity Matrix"%name)
        if row == nrows-1:
            plt.xlabel("Time (sec)")
        if col == 0:
            plt.ylabel("Time (sec)")
        if name in alllabels:
            plt.subplot2grid((nrows, 8*3), (row, col*8+7))
            levels = [0] # Look at only finest level for now
            labels = np.zeros((W.shape[0], len(levels)))
            for k, level in enumerate(levels):
                labels[:, k] = alllabels[name][level]['labels']
            if time_uniform:
                plt.imshow(labels, cmap = 'tab20b', interpolation='nearest', aspect='auto', extent=(0, 1, times[-1], times[0]))
            else:
                plt.pcolormesh(np.arange(labels.shape[1]+1), times, labels, cmap = 'tab20b')
                plt.gca().invert_yaxis()
            plt.axis('off')
            plt.title("Clusters")
    #plt.tight_layout()
    if len(labels_hier) > 0:
        for k in range(2):
            plt.subplot2grid((nrows, 8*3), (nrows-1, 10+k*3))
            labels = []
            labelsdict = {}
            for a in labels_hier[k]:
                if not a in labelsdict:
                    labelsdict[a] = len(labelsdict)
                labels.append(labelsdict[a])
            labels = np.array(labels)
            plt.pcolormesh(np.arange(2), intervals_hier[k][:, 0], np.concatenate((labels[:, None], labels[:, None]), 1), cmap='tab20b')
            for i in range(intervals_hier[k].shape[0]):
                t = intervals_hier[k][i, 0]
                plt.plot([0, 1], [t, t], 'k', linestyle='--')
            plt.gca().invert_yaxis()
    return fig

def getFusedSimilarity(filename, sr = 44100, hop_length = 512, win_fac = 10, wins_per_block = 20, K = 5, reg_diag = 1.0, reg_neighbs = 0.5, niters = 3, do_animation = False, plot_result = False):
    """
    Load in filename, compute features, average/stack delay, and do similarity
    network fusion (SNF) on all feature types
    Parameters
    ----------
    filename: string
        Path to music file
    sr: int
        Sample rate at which to sample file
    hop_length: int
        Hop size between frames in chroma and mfcc
    win_fac: int
        Number of frames to average (i.e. factor by which to downsample)
        If negative, then do beat tracking, and subdivide by |win_fac| times within each beat
    wins_per_block: int
        Number of aggregated windows per sliding window block
    K: int
        Number of nearest neighbors in SNF.  If -1, then autotuned to sqrt(N)
        for an NxN similarity matrix
    reg_diag: float 
        Regularization for self-similarity promotion
    reg_neighbs: float
        Regularization for direct neighbor similarity promotion
    niters: int
        Number of iterations in SNF
    do_animation: boolean
        Whether to plot and save images of the evolution of SNF
    plot_result: boolean
        Whether to plot the result of the fusion
    Returns
    -------
    {'Ws': An dictionary of weighted adjacency matrices for individual features
                    and the fused adjacency matrix, 
            'times': Time in seconds of each row in the similarity matrices,
            'K': The number of nearest neighbors actually used} 
    """
    ## Step 1: Load audio
    print("Loading %s..."%filename)
    y, sr = librosa.load(filename, sr=sr)
    
    ## Step 2: Figure out intervals to which to sync features
    if win_fac > 0:
        # Compute features in intervals evenly spaced by the hop size
        # but average within "win_fac" intervals of hop_length
        nHops = int((y.size-hop_length*win_fac*wins_per_block)/hop_length)
        intervals = np.arange(0, nHops, win_fac)
    else:
        # Compute features in intervals which are subdivided beats
        # by a factor of |win_fac|
        C = np.abs(librosa.cqt(y=y, sr=sr))
        _, beats = librosa.beat.beat_track(y=y, sr=sr, trim=False, start_bpm=240)
        intervals = librosa.util.fix_frames(beats, x_max=C.shape[1])
        intervals = librosa.segment.subsegment(C, intervals, n_segments=abs(win_fac))

    ## Step 3: Compute features
    # 1) CQT chroma with 3x oversampling in pitch
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length, bins_per_octave=12*3)

    # 2) Exponentially liftered MFCCs
    S = librosa.feature.melspectrogram(y, sr=sr, n_mels=128, hop_length=hop_length)
    log_S = librosa.power_to_db(S, ref=np.max)
    mfcc = librosa.feature.mfcc(S=log_S, n_mfcc=20)
    lifterexp = 0.6
    coeffs = np.arange(mfcc.shape[0])**lifterexp
    coeffs[0] = 1
    mfcc = coeffs[:, None]*mfcc

    # 3) Tempograms
    #  Use a super-flux max smoothing of 5 frequency bands in the oenv calculation
    SUPERFLUX_SIZE = 5
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length,
                                        max_size=SUPERFLUX_SIZE)
    tempogram = librosa.feature.tempogram(onset_envelope=oenv, sr=sr, hop_length=hop_length)
    
    ## Step 4: Synchronize features to intervals
    n_frames = np.min([chroma.shape[1], mfcc.shape[1], tempogram.shape[1]])
    # median-aggregate chroma to suppress transients and passing tones
    intervals = librosa.util.fix_frames(intervals, x_min=0, x_max=n_frames)
    times = intervals*float(hop_length)/float(sr)

    chroma = librosa.util.sync(chroma, intervals, aggregate=np.median)
    chroma = chroma[:, :n_frames]
    mfcc = librosa.util.sync(mfcc, intervals)
    mfcc = mfcc[:, :n_frames]
    tempogram = librosa.util.sync(tempogram, intervals)
    tempogram = tempogram[:, :n_frames]
    

    ## Step 5: Do a delay embedding and compute SSMs
    XChroma = librosa.feature.stack_memory(chroma, n_steps=wins_per_block, mode='edge').T
    DChroma = getCSMCosine(XChroma, XChroma) #Cosine distance
    XMFCC = librosa.feature.stack_memory(mfcc, n_steps=wins_per_block, mode='edge').T
    DMFCC = getCSM(XMFCC, XMFCC) #Euclidean distance
    XTempogram = librosa.feature.stack_memory(tempogram, n_steps=wins_per_block, mode='edge').T
    DTempogram = getCSM(XTempogram, XTempogram)

    ## Step 5: Run similarity network fusion
    FeatureNames = ['MFCCs', 'Chromas']
    Ds = [DMFCC, DChroma, DTempogram]
    # Edge case: If it's too small, zeropad SSMs
    for i, Di in enumerate(Ds):
        if Di.shape[0] < 2*K:
            D = np.zeros((2*K, 2*K))
            D[0:Di.shape[0], 0:Di.shape[1]] = Di
            Ds[i] = D
    pK = K
    if K == -1:
        pK = int(np.round(2*np.log(Ds[0].shape[0])/np.log(2)))
        print("Autotuned K = %i"%pK)
    # Do fusion on all features
    Ws = [getW(D, pK) for D in Ds]

    WFused = doSimilarityFusionWs(Ws, K=pK, niters=niters, \
        reg_diag=reg_diag, reg_neighbs=reg_neighbs, \
        do_animation=do_animation, PlotNames=FeatureNames, \
        PlotExtents=[times[0], times[-1]]) 
    WsDict = {}
    for n, W in zip(FeatureNames, Ws):
        WsDict[n] = W
    WsDict['Fused'] = WFused
    # Do fusion with only Chroma and MFCC
    #WsDict['Fused MFCC/Chroma'] = doSimilarityFusionWs(Ws[0:2], K=pK, niters=niters, \
    #    reg_diag=reg_diag, reg_neighbs=reg_neighbs)
    if plot_result:
        plotFusionResults(WsDict, {}, {}, times, win_fac)
        plt.savefig("%s_Plot.png"%filename, bbox_inches='tight')
    return {'Ws':WsDict, 'times':times, 'K':pK}


def get_graph_obj(W, K=10, res = 400):
    """
    Return an object corresponding to a nearest neighbor graph
    Parameters
    ----------
    W: ndarray(N, N)
        The N x N time-ordered similarity matrix
    K: int
        Number of nearest neighbors to use in graph representation
    res: int
        Target resolution of resized image
    """
    fac = 1
    if res > -1:
        fac = int(np.round(W.shape[0]/float(res)))
        res = int(W.shape[0]/fac)
        WRes = imresize(W, (res, res))
    else:
        res = W.shape[0]
        WRes = np.array(W)
    np.fill_diagonal(WRes, 0)
    pix = np.arange(res)
    I, J = np.meshgrid(pix, pix)
    WRes[np.abs(I - J) == 1] = np.max(WRes)
    c = plt.get_cmap('Spectral')
    C = c(np.array(np.round(np.linspace(0, 255,res)), dtype=np.int32))
    C = np.array(np.round(C[:, 0:3]*255), dtype=int)
    colors = C.tolist()

    K = min(int(np.round(K*2.0/fac)), res) # Use slightly more edges
    print("res = %i, K = %i"%(res, K))
    S = getS(WRes, K).tocoo()
    I, J, V = S.row, S.col, S.data
    V *= 10
    ret = {}
    ret["nodes"] = [{"id":"%i"%i, "color":colors[i]} for i in range(res)]
    ret["links"] = [{"source":"%i"%I[i], "target":"%i"%J[i], "value":"%.3g"%V[i]} for i in range(I.shape[0])]
    ret["fac"] = fac
    return ret